import openssl from "tg:openssl" with { path: "../openssl" };
import * as std from "tg:std" with { path: "../std" };
import zlib from "tg:zlib" with { path: "../zlib" };

import * as proxy_ from "./proxy.tg.ts";
export * as proxy from "./proxy.tg.ts";

export let metadata = {
	name: "rust",
	version: "0.0.0",
};

let VERSION = "1.77.0" as const;
let PROFILE = "minimal" as const;

type ToolchainArg = {
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	target?: tg.Triple;
	targets?: Array<tg.Triple>;
};

export let rust = tg.target(async (arg?: ToolchainArg) => {
	// Determine the list of target triples to support other than the inferred host.
	let detectedHost = await tg.Triple.host();
	let host = rustTriple(detectedHost);
	let targets = [];
	if (arg?.target && !tg.Triple.eq(arg.target, host)) {
		targets.push(arg.target);
	}
	if (arg?.targets) {
		for (let target of arg?.targets) {
			if (!tg.Triple.eq(target, host)) {
				targets.push(target);
			}
		}
	}

	// Download the Rust manifest for the selected version.
	let manifestArtifact = await std.download({
		url: `https://static.rust-lang.org/dist/channel-rust-${VERSION}.toml`,
		checksum: "unsafe",
	});

	// Parse the manifest.
	tg.assert(tg.File.is(manifestArtifact));
	let manifest = (await tg.encoding.toml.decode(
		await manifestArtifact.text(),
	)) as RustupManifestV2;

	// Get the system metadata.
	let hostTripleString = tg.Triple.toString(host);

	// Get all the available packages for the selected profile and target.
	let packageNames = manifest.profiles[PROFILE];
	tg.assert(Array.isArray(packageNames));
	let packages = packageNames.flatMap((packageName) => {
		let data = manifest.pkg[packageName];
		let pkg = data?.target[hostTripleString];
		if (pkg?.available === true) {
			return [[packageName, pkg]] as const;
		} else {
			return [];
		}
	});

	// Add any additionally requested rust-std targets.
	for (let target of targets) {
		let name = "rust-std";
		let targetTripleString = tg.Triple.toString(target);
		let data = manifest.pkg[name];
		let pkg = data?.target[targetTripleString];
		if (pkg?.available === true) {
			packages.push([`${name}-${targetTripleString}`, pkg]);
		}
	}

	// Download each package, and add each one as a subdirectory. The subdirectory will be named with the package's name.
	let packagesArtifact = await tg.directory();
	for (let [name, pkg] of packages) {
		let artifact = await std.download({
			checksum: `sha256:${pkg.xz_hash}`,
			unpackFormat: ".tar.xz" as const,
			url: pkg.xz_url,
		});
		packagesArtifact = await tg.directory(packagesArtifact, {
			[name]: artifact,
		});
	}

	// Obtain an SDK.  If cross-targets were specified, use a cross-compiling SDK.
	let sdk = await std.sdk({ host, targets }, arg?.sdk);
	tg.assert(tg.File.is(sdk));

	// Install each package.
	let rustInstall = await std.build(
		tg`
			for package in ${packagesArtifact}/*/* ; do
				echo "Installing $package"
				bash "$package/install.sh" --prefix="$OUTPUT"
				chmod -R +w "$OUTPUT"
			done
		`,
		{ env: sdk },
	);

	tg.assert(
		tg.Directory.is(rustInstall),
		`Expected rust installation to be a directory.`,
	);

	// Wrap the Rust binaries.
	let executables = [
		"bin/rustc",
		"bin/cargo",
		"bin/rustdoc",
		"bin/rust-gdb",
		"bin/rust-gdbgui",
		"bin/rust-lldb",
	];

	let artifact = tg.directory();

	let zlibArtifact = await zlib(arg);

	for (let executable of executables) {
		let wrapped = std.wrap(tg.symlink(tg`${rustInstall}/${executable}`), {
			libraryPaths: [
				tg.symlink(tg`${rustInstall}/lib`),
				tg.symlink(tg`${zlibArtifact}/lib`),
			],
		});

		artifact = tg.directory(artifact, {
			[executable]: wrapped,
		});
	}

	return artifact;
});

export default rust;

export type Arg = {
	env?: std.env.Arg;
	features?: Array<string>;
	host?: tg.Triple.Arg;
	proxy?: boolean;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Artifact;
	target?: tg.Triple.Arg;
	useCargoVendor?: boolean;
};

export let build = async (...args: tg.Args<Arg>) => {
	type Apply = {
		env: Array<std.env.Arg>;
		features: Array<string>;
		host: tg.Triple.Arg;
		proxy: boolean;
		sdk: Array<std.sdk.Arg>;
		source: tg.Artifact;
		target: tg.Triple.Arg;
		useCargoVendor: boolean;
	};
	let {
		env,
		features = [],
		host: host_,
		proxy = false,
		sdk: sdk_,
		source,
		target: target_,
		useCargoVendor = false,
	} = await tg.Args.apply<Arg, Apply>(args, async (arg) => {
		if (arg === undefined) {
			return {};
		} else {
			let object: tg.MutationMap<Apply> = {};
			if (arg.env !== undefined) {
				object.env = tg.Mutation.is(arg.env)
					? arg.env
					: await tg.Mutation.arrayAppend<std.env.Arg>(arg.env);
			}
			if (arg.sdk !== undefined) {
				object.sdk = tg.Mutation.is(arg.sdk)
					? arg.sdk
					: await tg.Mutation.arrayAppend<std.sdk.Arg>(arg.sdk);
			}
			if (arg.features !== undefined) {
				object.features = tg.Mutation.is(arg.features)
					? arg.features
					: await tg.Mutation.arrayAppend(arg.features);
			}
			if (arg.source !== undefined) {
				object.source = arg.source;
			}
			if (arg.proxy !== undefined) {
				object.proxy = arg.proxy;
			}
			if (arg.useCargoVendor !== undefined) {
				object.useCargoVendor = arg.useCargoVendor;
			}
			return object;
		}
	});

	let host = rustTriple(host_ ? tg.triple(host_) : await tg.Triple.host());
	let target = target_ ? rustTriple(tg.triple(target_)) : host;

	// Check if we're cross-compiling.
	let crossCompiling = !tg.Triple.eq(target, host);

	// Obtain handles to the SDK and Rust artifacts.
	// NOTE - pulls an SDK assuming the selected target is the intended host.
	let sdk = std.sdk({ host, target }, sdk_ ?? []);
	let rustArtifact = rust({ target });

	// Compute some necessary metadata.
	let targetTriple = tg.Triple.toString(target);

	// Download the dependencies using the cargo vendor.
	tg.assert(source, "Must provide a source directory.");
	let cargoConfig = vendoredSources({ source, useCargoVendor });

	// Create the build script.
	let buildScript = tg`
		set -eux
		# Create the output directory
		mkdir -p "$OUTPUT/target"

		# Create the cargo config to read vendored dependencies. Note: as of Rust 1.74.0 (stable), Cargo does not support reading these config keys from environment variables.

		mkdir -p "$HOME/.cargo"
		echo '${cargoConfig}' >> "$HOME/.cargo/config"

		echo "Cargo config:"
		cat "$HOME/.cargo/config"
		echo ""

		export CARGO_HOME=$HOME/.cargo

		cargo --tangram-print-manifest

		# Build.
		TARGET_DIR="$(realpath "$OUTPUT/target")"
		SOURCE="$(realpath ${source})"
		cargo build                            \
			--release                            \
			--target-dir "$TARGET_DIR"           \
			--manifest-path "$SOURCE/Cargo.toml" \
			--features "${features.join(",")}"   \
			--frozen                             \
			--offline                            \
			--target "$RUST_TARGET"
	`;

	// When not cross-compiling, ensure the `cc` provided by the SDK is used, which enables Tangram linking.
	let additionalEnv = {
		[`CARGO_TARGET_${tripleToEnvVar(target, true)}_LINKER`]: tg`cc`,
	};

	// If cross-compiling, set additional environment variables.
	if (crossCompiling) {
		additionalEnv = {
			[`CARGO_TARGET_${tripleToEnvVar(target, true)}_LINKER`]: tg`${targetTriple}-cc`,
			[`AR_${tripleToEnvVar(target)}`]: tg`${targetTriple}-ar`,
			[`CC_${tripleToEnvVar(target)}`]: tg`${targetTriple}-cc`,
			[`CXX_${tripleToEnvVar(target)}`]: tg`${targetTriple}-c++`,
		};
	}

	let proxyEnv = undefined;
	if (proxy) {
		proxyEnv = {
			RUSTC_WRAPPER: tg`${proxy_.proxy()}/bin/tangram_rustc`,
		};
	}

	let artifact = await std.build(buildScript, {
		env: std.env(
			sdk,
			rustArtifact,
			{
				RUST_TARGET: targetTriple,
				CARGO_REGISTRIES_CRATES_IO_PROTOCOL: "sparse",
				...additionalEnv,
			},
			proxyEnv,
			{ TANGRAM_HOST: tg.Triple.toString(tg.Triple.archAndOs(host)) },
			env,
		),
	});

	// Ensure the output artifact matches the expected structure.
	tg.assert(tg.Directory.is(artifact));

	// Store a handle to the release directory containing Tangram bundles.
	let releaseDir = await artifact.get(`target/${targetTriple}/release`);
	tg.assert(tg.Directory.is(releaseDir));

	// Grab the bins from the release dir.
	let bins: Map<string, tg.Artifact> = new Map();
	for await (let [name, artifact] of releaseDir) {
		if (tg.File.is(artifact)) {
			if (await artifact.executable()) {
				bins.set(name, artifact);
			}
		}
	}

	// Construct a result containing all located executables.
	let binDir = await tg.directory({});
	for (let [name, artifact] of bins) {
		binDir = await tg.directory(binDir, {
			[name]: artifact,
		});
	}
	return tg.directory({
		["bin"]: binDir,
	});
};

export type VendoredSourcesArg = {
	rustTarget?: tg.Triple.Arg;
	source: tg.Artifact;
	useCargoVendor?: boolean;
};

let vendoredSources = async (arg: VendoredSourcesArg): Promise<tg.Template> => {
	let { rustTarget: rustTarget_, source, useCargoVendor = false } = arg;
	let rustTarget = rustTarget_
		? tg.triple(rustTarget_)
		: await tg.Triple.host();
	let rustTargetString = tg.Triple.toString(rustTarget);
	if (useCargoVendor) {
		// Run cargo vendor
		let certFile = tg`${std.caCertificates()}/cacert.pem`;
		let vendorScript = tg`
			SOURCE="$(realpath ${source})"
			mkdir -p "$OUTPUT/tg_vendor_dir"
			cd "$OUTPUT"
			cargo vendor --versioned-dirs --locked --manifest-path $SOURCE/Cargo.toml tg_vendor_dir > "$OUTPUT/config"
		`;
		let rustArtifact = rust();
		let sdk = std.sdk();
		let result = await std.build(vendorScript, {
			checksum: "unsafe",
			env: [
				sdk,
				{
					CARGO_REGISTRIES_CRATES_IO_PROTOCOL: "sparse",
					CARGO_HTTP_CAINFO: certFile,
					PATH: tg`${rustArtifact}/bin`,
					RUST_TARGET: rustTargetString,
					SSL_CERT_FILE: certFile,
				},
			],
		});

		// Get the output.
		tg.assert(tg.Directory.is(result));
		let vendoredSources = await result.get("tg_vendor_dir");
		tg.assert(tg.Directory.is(vendoredSources));
		let config = await result.get("config");
		tg.assert(tg.File.is(config));

		let text = await config.text();
		let match = /tg_vendor_dir/g.exec(text);
		tg.assert(match);
		return tg`${text.substring(
			0,
			match.index,
		)}${vendoredSources}${text.substring(match.index + match[0].length)}`;
	} else {
		let cargoLock = await (await tg.symlink(source, "Cargo.lock")).resolve();
		tg.assert(tg.File.is(cargoLock));
		let vendoredSources = vendorDependencies(cargoLock);
		return tg`
[source.crates-io]
replace-with = "vendored-sources"

[source.vendored-sources]
directory = "${vendoredSources}"`;
	}
};

// Implementation of `cargo vendor` in tg typescript.
export let vendorDependencies = tg.target(async (cargoLock: tg.File) => {
	type CargoLock = {
		package: Array<{
			name: string;
			version: string;
			source?: string;
			dependencies?: Array<String>;
			checksum?: string;
		}>;
	};

	let cargoLockToml = tg.encoding.toml.decode(
		await cargoLock.text(),
	) as CargoLock;
	let downloads = cargoLockToml.package
		.filter((pkg) => {
			return pkg.source?.startsWith("registry+") ?? false;
		})
		.map(async (pkg) => {
			tg.assert(pkg.source);
			tg.assert(pkg.checksum);
			let checksum = `sha256:${pkg.checksum}`;
			let unpackFormat = ".tar.gz" as const;
			let url = `https://crates.io/api/v1/crates/${pkg.name}/${pkg.version}/download`;
			let artifact = await std.download({
				checksum,
				unpackFormat,
				url,
			});
			tg.assert(tg.Directory.is(artifact));
			let child = await artifact.get(`${pkg.name}-${pkg.version}`);
			tg.assert(tg.Directory.is(child));
			return tg.directory({
				[`${pkg.name}-${pkg.version}`]: vendorPackage(child, checksum),
			});
		});

	return tg.directory(...downloads);
});

// Given a crate directory downloaded from crates.io and its checksum, strip excess files and generate the .cargo-checksum.json.
export let vendorPackage = async (
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
	let cargoChecksum: CargoChecksum = {
		files: {},
		package: checksum.replace("sha256:", ""),
	};

	// Recurse over the files to create it.
	let stack: Array<[string, tg.Directory]> = [["", pkg]];
	while (!(stack.length == 0)) {
		let [path, dir] = stack.pop() as [string, tg.Directory];
		for (let [subpath, artifact] of Object.entries(await dir.entries())) {
			subpath = `${path}${subpath}`;
			if (tg.Directory.is(artifact)) {
				stack.push([`${subpath}/`, artifact]);
			} else if (tg.File.is(artifact)) {
				let bytes = await artifact.bytes();
				let checksum = tg.checksum("sha256", bytes);
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

type RustupManifestV2 = {
	"manifest-version": "2";
	artifacts: {
		[artifact: string]: {
			target: {
				[target: string]: Array<{
					"hash-sha256": string;
					url: string;
				}>;
			};
		};
	};
	date: string;
	pkg: {
		[pkg: string]: {
			git_commit_hash: string;
			target: {
				[target: string]:
					| undefined
					| { available: false }
					| {
							available: true;
							hash: string;
							url: string;
							xz_hash: string;
							xz_url: string;
					  };
			};
			version: string;
		};
	};
	profiles: {
		[profile: string]: Array<string>;
	};
	renames: {
		[alias: string]: {
			to: string;
		};
	};
};

let rustTriple = (triple: tg.Triple): tg.Triple => {
	let normalized = tg.Triple.normalized(triple);
	tg.assert(
		normalized,
		`Could not convert triple to Rust triple: ${tg.Triple.toString(triple)}`,
	);
	let base = tg.triple(normalized);
	if (base.os === "darwin") {
		return tg.triple({
			arch: base.arch,
			vendor: "apple",
			os: base.os,
		});
	} else if (base.os === "linux") {
		return tg.triple({
			arch: base.arch,
			vendor: base.vendor,
			os: base.os,
			environment: base.environment ?? "gnu",
		});
	} else {
		throw new Error(`Unsupported OS: ${base.os}`);
	}
};

let tripleToEnvVar = (triple: tg.Triple, upcase?: boolean) => {
	let tripleString = tg.Triple.toString(triple);
	let allCaps = upcase ?? false;
	let result = tripleString.replace(/-/g, "_");
	if (allCaps) {
		result = result.toUpperCase();
	}
	return result;
};

export let test = tg.target(async () => {
	let tests = [testHost()];
	let os = tg.Triple.os(await tg.Triple.host());
	if (os === "linux") {
		tests.push(testCross());
	}
	await Promise.all(tests);
	return true;
});

export let testHost = tg.target(async () => {
	let rustArtifact = await rust();

	let script = tg`
		${rustArtifact}/bin/rustc --version
		${rustArtifact}/bin/cargo --version
	`;

	await tg.build(script);
	return true;
});

export let testCross = tg.target(async () => {
	// Detect the host triple.
	let host = await tg.Triple.host();

	// Determine the target triple with differing architecture from the host.
	let hostArch = host.arch;
	let targetArch: tg.Triple.Arch = hostArch === "x86_64" ? "aarch64" : "x86_64";
	let target = tg.triple({
		arch: targetArch,
		vendor: "unknown",
		os: "linux",
		environment: "gnu",
	});

	let crossRust = await rust({ targets: [target] });

	let script = tg`
		${crossRust}/bin/rustc --version
		${crossRust}/bin/cargo --version
	`;

	await tg.build(script);
	return true;
});

export let testProxy = tg.target(async () => {
	let helloWorld = build({
		source: tg.include("./tests/hello-world"),
		proxy: true,
	});

	let helloOpenssl = build({
		source: tg.include("./tests/hello-openssl"),
		env: [await openssl()],
		proxy: true,
	});

	return tg.build(tg`
		${helloWorld}/bin/hello-world     >> $OUTPUT
		${helloOpenssl}/bin/hello-openssl >> $OUTPUT
	`);
});

// Compare the results of cargo vendor and vendorDependencies.
export let testVendorDependencies = tg.target(async () => {
	let sourceDirectory = await tg.include("./tests/hello-openssl");
	tg.assert(tg.Directory.is(sourceDirectory));
	let cargoLock = await sourceDirectory.get("Cargo.lock");
	tg.assert(tg.File.is(cargoLock));
	let tgVendored = vendorDependencies(cargoLock);

	let certFile = tg`${std.caCertificates()}/cacert.pem`;
	let vendorScript = tg`
		SOURCE="$(realpath ${sourceDirectory})"
		cargo vendor --versioned-dirs --locked --manifest-path $SOURCE/Cargo.toml "$OUTPUT"
	`;
	let rustArtifact = rust();
	let sdk = std.sdk();
	let executable = std.wrap(vendorScript, {
		env: std.env(sdk, {
			CARGO_REGISTRIES_CRATES_IO_PROTOCOL: "sparse",
			CARGO_HTTP_CAINFO: certFile,
			PATH: tg`${rustArtifact}/bin`,
			RUST_TARGET: "x86_64-linux-unknown-gnu",
			SSL_CERT_FILE: certFile,
		}),
	});
	let cargoVendored = await std.build({
		executable,
		checksum: "unsafe",
	});
	return tg.directory({
		tgVendored,
		cargoVendored,
	});
});
