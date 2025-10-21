import * as std from "std" with { local: "../std" };
import pkgconf from "pkgconf" with { local: "../pkgconf" };
import { $ } from "std" with { local: "../std" };
import * as proxy_ from "./proxy.tg.ts";
import { rustTriple, self } from "./tangram.ts";

export type Arg = {
	/** By default, cargo builds compile "out-of-tree", creating build artifacts in a mutable working directory but referring to an immutable source. Enabling `buildInTree` will instead first copy the source directory into the working build directory. Default: false. */
	buildInTree?: boolean;

	/** If the build requires network access, provide a checksum or the string "any" to accept any result. */
	checksum?: tg.Checksum;

	/** Should the default features get disabled? Default: false. */
	disableDefaultFeatures?: boolean;

	/** Environment variables to set during the build. */
	env?: std.env.Arg;

	/** Features to enable during the build. */
	features?: Array<string>;

	/** Machine that will run the compilation. */
	host?: string;

	/** Parent of the directory containing the Cargo.toml relative to the source dir if not at the expected location. */
	manifestSubdir?: string;

	/** Should this build have network access? Must set a checksum to enable. Default: false. */
	network?: boolean;

	/** Number of parallel jobs to use. */
	parallelJobs?: number;

	/** Should the build environment include pkg-config? Default: true. */
	pkgConfig?: boolean;

	/** Additional script to run prior to the build */
	pre?: tg.Template.Arg;

	/** Whether to use the tangram_rustc proxy. */
	proxy?: boolean;

	/** SDK configuration to use during the build. */
	sdk?: std.sdk.Arg;

	/** Source directory. */
	source: tg.Directory;

	/** Target triple for the build. */
	target?: string;

	/** Whether to use cargo vendor instead of the Tangram-native vendoring. */
	useCargoVendor?: boolean;

	/** Whether to enable verbose logging. */
	verbose?: boolean;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		buildInTree = false,
		checksum,
		disableDefaultFeatures = false,
		env: env_,
		features = [],
		host: host_,
		manifestSubdir,
		network = false,
		parallelJobs,
		pkgConfig = true,
		pre,
		proxy = false,
		sdk: sdk_ = {},
		source,
		target: target_,
		useCargoVendor = false,
		verbose = false,
	} = await std.args.apply<Arg, Arg>({
		args,
		map: async (arg) => arg,
		reduce: {
			env: (a, b) => std.env.arg(a, b),
			features: "append",
			sdk: (a, b) => std.sdk.arg(a, b),
			source: "set",
		},
	});
	tg.assert(source, "Must provide a source directory.");

	const host = host_ ?? (await std.triple.host());
	const rustHost = rustTriple(host);
	const os = std.triple.os(rustHost);
	const target = target_ ? rustTriple(target_) : rustHost;

	// Check if we're cross-compiling.
	const crossCompiling = target !== rustHost;

	// Obtain handles to the SDK and Rust artifacts.
	// NOTE - pulls an SDK assuming the selected target is the intended host. Forces GCC on Linux, as rustc expects libgcc_s.
	const sdkArgs: Array<std.sdk.Arg> = [{ host: rustHost, target }, sdk_];
	if (
		os === "linux" &&
		sdkArgs.filter((arg) => arg?.toolchain === "llvm").length > 0
	) {
		sdkArgs.push({ toolchain: "gnu" });
	}

	const envs: Array<tg.Unresolved<std.env.Arg>> = [];

	const sdk = await tg.build(std.sdk, ...sdkArgs);
	envs.push(sdk);
	const rustArtifact = await tg.build(self, { host: rustHost, target });
	envs.push(rustArtifact);
	if (pkgConfig) {
		envs.push(await tg.build(pkgconf, { host }));
	}

	// Download the dependencies using the cargo vendor.
	const cargoConfig = vendoredSources({
		manifestSubdir,
		source,
		useCargoVendor,
	});

	// Create the cargo config to read vendored dependencies. Note: as of Rust 1.74.0 (stable), Cargo does not support reading these config keys from environment variables.
	const preparePathCommands = [
		`mkdir -p "$OUTPUT/target"`,
		`export TARGET_DIR="$(realpath "$OUTPUT/target")"`,
		tg`mkdir -p "$PWD/.cargo"\necho '${cargoConfig}' >> "$PWD/.cargo/config.toml"\nexport CARGO_HOME=$PWD/.cargo`,
	];
	const preparePaths = tg.Template.join("\n", ...preparePathCommands);

	// Set the SOURCE variable.
	const prepareSource = buildInTree
		? tg`cp -R ${source}/. $PWD/work\nchmod -R u+w $PWD/work\nexport SOURCE="$PWD/work"`
		: tg`export SOURCE=$(realpath ${source})`;

	// Set up cargo args.
	const manifestPathArg = manifestSubdir
		? `${manifestSubdir}/Cargo.toml`
		: `"Cargo.toml"`;
	const cargoArgs = [
		"--release",
		`--target-dir "$OUTPUT/target"`,
		`--manifest-path "$SOURCE/${manifestPathArg}"`,
		`--features "${features.join(",")}"`,
		"--target $RUST_TARGET",
	];
	if (!network) {
		cargoArgs.push("--offline", "--frozen");
	}
	if (disableDefaultFeatures) {
		cargoArgs.push("--no-default-features");
	}

	// Create the build script.
	const cargoArgString = cargoArgs.join(" ");
	const buildCommand = `cargo build ${cargoArgString}`;
	const buildScript = tg.Template.join(
		"\n",
		preparePaths,
		prepareSource,
		pre,
		buildCommand,
	);

	// When not cross-compiling, ensure the `gcc` provided by the SDK is used, which enables Tangram linking.
	let compilerName = "gcc";
	if (os === "darwin") {
		compilerName = "clang";
	}
	const toolchainEnv = {
		[`CARGO_TARGET_${tripleToEnvVar(target, true)}_LINKER`]: compilerName,
		RUST_TARGET: target,
		CARGO_REGISTRIES_CRATES_IO_PROTOCOL: "sparse",
		TANGRAM_HOST: std.triple.archAndOs(rustHost),
	};
	envs.push(toolchainEnv);

	// If network is enabled, set the certificates.
	if (network) {
		const certFile = tg`${std.caCertificates()}/cacert.pem`;
		const networkEnv = {
			SSL_CERT_FILE: certFile,
			CARGO_HTTP_CAINFO: certFile,
		};
		envs.push(networkEnv);
	}

	// If cross-compiling, set additional environment variables.
	if (crossCompiling) {
		// Set both with and without swapping to underscores, and ensure we unconditionally set the linker.
		const crossEnv = {
			[`CARGO_TARGET_${tripleToEnvVar(target, true)}_LINKER`]: `${target}-cc`,
			[`AR_${tripleToEnvVar(target)}`]: tg.Mutation.setIfUnset(`${target}-ar`),
			[`AR_${target}`]: tg.Mutation.setIfUnset(`${target}-ar`),
			[`CC_${tripleToEnvVar(target)}`]: tg.Mutation.setIfUnset(`${target}-cc`),
			[`CC_${target}`]: tg.Mutation.setIfUnset(`${target}-cc`),
			[`CXX_${tripleToEnvVar(target)}`]: tg.Mutation.setIfUnset(
				`${target}-c++`,
			),
			[`CXX_${target}`]: tg.Mutation.setIfUnset(`${target}-c++`),
		};
		envs.push(crossEnv);
	}

	if (proxy) {
		const proxyEnv = {
			RUSTC_WRAPPER: tg`${proxy_.proxy()}/bin/tgrustc`,
		};
		envs.push(proxyEnv);
	}

	if (parallelJobs) {
		const jobsEnv = {
			CARGO_BUILD_JOBS: `${parallelJobs}`,
		};
		envs.push(jobsEnv);
	}

	if (verbose) {
		const verbosityEnv = {
			RUSTFLAGS: tg.Mutation.suffix("-v", " "),
			CARGO_TERM_VERBOSE: "true",
		};
		envs.push(verbosityEnv);
	}

	const env = std.env.arg(...envs, env_);

	const artifact = await $`${buildScript}`
		.checksum(checksum)
		.network(network)
		.env(env)
		.then(tg.Directory.expect);

	// Store a handle to the release directory containing Tangram bundles.
	const releaseDir = await artifact
		.get(`target/${target}/release`)
		.then(tg.Directory.expect);

	// Grab the bins from the release dir.
	const bins: Record<string, tg.Artifact> = {};
	for await (const [name, artifact] of releaseDir) {
		if (artifact instanceof tg.File) {
			if (await artifact.executable()) {
				bins[name] = artifact;
			}
		}
	}

	// Construct a result containing all located executables.
	let binDir = await tg.directory({});
	for (const [name, artifact] of Object.entries(bins)) {
		binDir = await tg.directory(binDir, {
			[name]: artifact,
		});
	}
	return tg.directory({
		["bin"]: binDir,
	});
};

export type VendoredSourcesArg = {
	rustTarget?: string;
	manifestSubdir?: string | undefined;
	source: tg.Directory;
	useCargoVendor?: boolean;
};

const vendoredSources = async (
	arg: VendoredSourcesArg,
): Promise<tg.Template> => {
	const {
		rustTarget: rustTarget_,
		manifestSubdir,
		source,
		useCargoVendor = false,
	} = arg;
	const rustTarget = rustTarget_ ?? (await std.triple.host());
	if (useCargoVendor) {
		// Run cargo vendor
		const certFile = tg`${std.caCertificates()}/cacert.pem`;
		const manifestPathArg = manifestSubdir
			? `${manifestSubdir}/Cargo.toml`
			: `"Cargo.toml"`;
		const vendorScript = tg`
			set -x
			SOURCE="$(realpath ${source})"
			export CARGO_HOME=$PWD
			mkdir -p "$OUTPUT/tg_vendor_dir"
			cd "$OUTPUT"
			cargo fetch --locked --manifest-path $SOURCE/${manifestPathArg}

			# Copy git checkouts without .git directories to avoid macOS sandbox issues.
			if [ -d "$CARGO_HOME/git/checkouts" ]; then
				TEMP_CHECKOUTS="$CARGO_HOME/git/checkouts_temp"
				mkdir -p "$TEMP_CHECKOUTS"
				cd "$CARGO_HOME/git/checkouts"
				tar cf - --exclude='.git' . | (cd "$TEMP_CHECKOUTS" && tar xf -)
				cd "$OUTPUT"
				rm -rf "$CARGO_HOME/git/checkouts"
				mv "$TEMP_CHECKOUTS" "$CARGO_HOME/git/checkouts"
			fi

			cargo vendor --versioned-dirs --locked --manifest-path $SOURCE/${manifestPathArg} tg_vendor_dir > "$OUTPUT/config"
		`;
		const rustArtifact = self();
		const sdk = std.sdk();
		const result = await $`${vendorScript}`
			.checksum("sha256:any")
			.network(true)
			.env(sdk)
			.env(rustArtifact)
			.env({
				CARGO_REGISTRIES_CRATES_IO_PROTOCOL: "sparse",
				CARGO_HTTP_CAINFO: certFile,
				RUST_TARGET: rustTarget,
				SSL_CERT_FILE: certFile,
			})
			.then(tg.Directory.expect);

		// Get the output.
		const vendoredSources = await result
			.get("tg_vendor_dir")
			.then(tg.Directory.expect);
		const config = await result.get("config").then(tg.File.expect);

		const text = await config.text();
		const match = /tg_vendor_dir/g.exec(text);
		tg.assert(match);
		return tg`${text.substring(
			0,
			match.index,
		)}${vendoredSources}${text.substring(match.index + match[0].length)}`;
	} else {
		const sourcePath = manifestSubdir
			? await source.get(manifestSubdir).then(tg.Directory.expect)
			: source;
		const cargoLock = sourcePath.get("Cargo.lock").then(tg.File.expect);
		const vendoredSources = vendorDependencies(cargoLock);
		return tg`
[source.crates-io]
replace-with = "vendored-sources"

[source.vendored-sources]
directory = "${vendoredSources}"`;
	}
};

// Implementation of `cargo vendor` in tg typescript.
export const vendorDependencies = async (
	cargoLockArg: tg.Unresolved<tg.File>,
) => {
	const cargoLock = await tg.resolve(cargoLockArg);
	type CargoLock = {
		package: Array<{
			name: string;
			version: string;
			source?: string;
			dependencies?: Array<string>;
			checksum?: string;
		}>;
	};

	const cargoLockToml = tg.encoding.toml.decode(
		await cargoLock.text(),
	) as CargoLock;
	const downloads = cargoLockToml.package
		.filter((pkg) => {
			return pkg.source?.startsWith("registry+") ?? false;
		})
		.map(async (pkg) => {
			tg.assert(pkg.source);
			tg.assert(pkg.checksum);
			const checksum: tg.Checksum = `sha256:${pkg.checksum}`;
			const url = `https://crates.io/api/v1/crates/${pkg.name}/${pkg.version}/download`;
			const artifact = await std.download
				.extractArchive({
					checksum,
					url,
				})
				.then(tg.Directory.expect);
			const child = await artifact
				.get(`${pkg.name}-${pkg.version}`)
				.then(tg.Directory.expect);
			return tg.directory({
				[`${pkg.name}-${pkg.version}`]: vendorPackage(child, checksum),
			});
		});

	return tg.directory(...downloads);
};

// Given a crate directory downloaded from crates.io and its checksum, strip excess files and generate the .cargo-checksum.json.
export const vendorPackage = async (
	pkg: tg.Directory,
	checksum: tg.Checksum,
): Promise<tg.Directory> => {
	type CargoChecksum = {
		files: Record<string, string>;
		package: string;
	};

	// Strip out unused entries.
	pkg = await tg.directory(pkg, {
		[".cargo_vcs_info.json"]: undefined,
		[".gitignore"]: undefined,
		["Cargo.toml.orig"]: undefined,
	});

	// Create an empty .cargo-checksum.json.
	const cargoChecksum: CargoChecksum = {
		files: {},
		package: checksum.replace("sha256:", ""),
	};

	// Recurse over the files to create it.
	const stack: Array<[string, tg.Directory]> = [["", pkg]];
	while (!(stack.length == 0)) {
		const [path, dir] = stack.pop() as [string, tg.Directory];
		for (let [subpath, artifact] of Object.entries(await dir.entries())) {
			subpath = `${path}${subpath}`;
			if (artifact instanceof tg.Directory) {
				stack.push([`${subpath}/`, artifact]);
			} else if (artifact instanceof tg.File) {
				const bytes = await artifact.bytes();
				const checksum = await tg.checksum(bytes, "sha256");
				cargoChecksum.files[subpath] = checksum.replace("sha256:", "");
			} else {
				throw new Error("Found symlink in downloaded cargo artifact.");
			}
		}
	}

	return tg.directory(pkg, {
		[".cargo-checksum.json"]: tg.file(JSON.stringify(cargoChecksum)),
	});
};

const tripleToEnvVar = (triple: string, upcase?: boolean) => {
	const allCaps = upcase ?? false;
	let result = triple.replace(/-/g, "_");
	if (allCaps) {
		result = result.toUpperCase();
	}
	return result;
};

import tests from "./tests" with { type: "directory" };

export const test = async () => {
	const tests = [];

	tests.push(testUnproxiedWorkspace());
	tests.push(testVendorDependencies());

	await Promise.all(tests);

	return true;
};

import pkgConfig from "pkg-config" with { local: "../pkg-config" };
import openssl from "openssl" with { local: "../openssl" };
export const testUnproxiedWorkspace = async () => {
	const helloWorkspace = build({
		source: tests.get("hello-workspace").then(tg.Directory.expect),
		env: {
			TGLD_TRACING: "tgld=trace",
		},
		pre: "set -x",
		proxy: false,
		verbose: true,
	});

	const helloOutput = await $`
		${helloWorkspace}/bin/cli >> $OUTPUT
	`.then(tg.File.expect);
	const helloText = await helloOutput.text();
	tg.assert(helloText.trim() === "Hello from a workspace!");

	const helloOpenssl = build({
		source: tests.get("hello-openssl").then(tg.Directory.expect),
		env: std.env.arg(openssl(), pkgConfig(), {
			TGLD_TRACING: "tgld=trace",
		}),
		proxy: false,
	});

	const openSslOutput = await $`
		${helloOpenssl}/bin/hello-openssl >> $OUTPUT
	`.then(tg.File.expect);
	const openSslText = await openSslOutput.text();
	tg.assert(
		openSslText.trim() === "Hello, from a crate that links against libssl!",
	);
	return true;
};

export const testUnproxiedWorkspaceCross = async () => {
	const helloWorkspace = build({
		host: "aarch64-unknown-linux-gnu",
		target: "x86_64-unknown-linux-gnu",
		source: tests.get("hello-workspace").then(tg.Directory.expect),
		env: {
			TGLD_TRACING: "tgld=trace",
		},
		pre: "set -x",
		proxy: false,
		verbose: true,
	});
	return helloWorkspace;
};

// Compare the results of cargo vendor and vendorDependencies.
export const testVendorDependencies = async () => {
	const sourceDirectory = await tests
		.get("hello-openssl")
		.then(tg.Directory.expect);
	const cargoLock = await sourceDirectory
		.get("Cargo.lock")
		.then(tg.File.expect);
	const tgVendored = vendorDependencies(cargoLock);
	const cargoVendored = vendoredSources({
		source: sourceDirectory,
		useCargoVendor: true,
	});
	console.log("tgVendored", (await tgVendored).id);
	console.log("cargoVendored", await cargoVendored);
	return true;
};
