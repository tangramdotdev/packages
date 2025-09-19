import * as bootstrap from "../bootstrap.tg.ts";
import * as gnu from "../sdk/gnu.tg.ts";
import * as llvm from "../sdk/llvm.tg.ts";
import * as std from "../tangram.ts";
import cargoToml from "../Cargo.toml" with { type: "file" };
import cargoLock from "../Cargo.lock" with { type: "file" };
import packages from "../packages" with { type: "directory" };

export type Arg = {
	build?: string;
	host?: string;
	release?: boolean;
	source?: tg.Directory;
	verbose?: boolean;
};

/** Build the binaries that enable Tangram's wrapping and environment composition strategy. */
export const workspace = async (
	arg: tg.Unresolved<Arg>,
): Promise<tg.Directory> => {
	const {
		build: build_,
		host: host_,
		release = true,
		source: source_,
		verbose = false,
	} = await tg.resolve(arg);
	const host = host_ ?? (await std.triple.host());
	const buildTriple = build_ ?? host;

	// Get the source.
	const source = source_
		? source_
		: await tg.directory({
				"Cargo.toml": cargoToml,
				"Cargo.lock": cargoLock,
				packages: packages,
			});

	return await tg.build(build, {
		...(await std.triple.rotate({ build: buildTriple, host })),
		release,
		source,
		verbose,
	});
};

export const ccProxy = async (arg: tg.Unresolved<Arg>) =>
	await tg
		.build(workspace, arg)
		.then((dir) => dir.get("bin/cc_proxy"))
		.then(tg.File.expect);

export const ldProxy = async (arg: tg.Unresolved<Arg>) =>
	await tg
		.build(workspace, arg)
		.then((dir) => dir.get("bin/ld_proxy"))
		.then(tg.File.expect);

export const stripProxy = async (arg: tg.Unresolved<Arg>) =>
	await tg
		.build(workspace, arg)
		.then((dir) => dir.get("bin/strip_proxy"))
		.then(tg.File.expect);

export const wrapper = async (arg: tg.Unresolved<Arg>) =>
	await tg
		.build(workspace, arg)
		.then((dir) => dir.get("bin/wrapper"))
		.then(tg.File.expect);

type ToolchainArg = {
	target?: string;
};

export const rust = async (
	arg?: tg.Unresolved<ToolchainArg>,
): Promise<tg.Directory> => {
	const resolved = await tg.resolve(arg);
	const host = standardizeTriple(await std.triple.host());
	const target = standardizeTriple(resolved?.target ?? host);
	const hostSystem = std.triple.archAndOs(host);

	// Download and parse the Rust manifest for the selected version.
	const version = "1.90.0";
	const manifestBlob = await std.download({
		url: `https://static.rust-lang.org/dist/channel-rust-${version}.toml`,
		checksum:
			"sha256:489c19f20d331765ab2835661eb546de90f6446a107a8db83045e7371e45cae2",
	});
	tg.Blob.assert(manifestBlob);
	const manifestFile = await tg.file(manifestBlob as tg.Blob);
	const manifest = tg.encoding.toml.decode(
		await manifestFile.text(),
	) as RustupManifest;

	// Install the full minimal profile for the host.
	let packages = tg.directory();
	for (const name of manifest.profiles["minimal"] ?? []) {
		const pkg = manifest.pkg[name]?.target[host];
		if (pkg?.available) {
			const artifact = std.download.extractArchive({
				checksum: `sha256:${pkg.xz_hash}`,
				url: pkg.xz_url,
			});
			packages = tg.directory(packages, {
				[name]: artifact,
			});
		}
	}

	// If there is a target specified different from the host, install just the rust-std package for that target.
	if (host !== target) {
		const name = "rust-std";
		const pkg = manifest.pkg[name]?.target[target];
		if (pkg?.available) {
			const artifact = std.download.extractArchive({
				checksum: `sha256:${pkg.xz_hash}`,
				url: pkg.xz_url,
			});
			packages = tg.directory(packages, {
				[name]: artifact,
			});
		}
	}

	// Install the packages.
	const env = bootstrap.sdk.env(host);
	return await std.build`
		for package in ${packages}/*/* ; do
			sh $package/install.sh --prefix="$OUTPUT"
			chmod -R +w "$OUTPUT"
		done`
		.bootstrap(true)
		.host(hostSystem)
		.env(env)
		.then(tg.Directory.expect);
};

type RustupManifest = {
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

type BuildArg = {
	enableTracingFeature?: boolean;
	host?: string;
	release?: boolean;
	source: tg.Directory;
	target?: string;
	verbose?: boolean;
};

export const build = async (unresolved: tg.Unresolved<BuildArg>) => {
	const arg = await tg.resolve(unresolved);
	const enableTracing = arg.enableTracingFeature ?? true;
	const release = arg.release ?? true;
	const source = arg.source;
	let host = arg.host ?? (await std.triple.host());
	const standardizedHost = standardizeTriple(host);
	let target = arg.target ?? standardizedHost;
	const standardizedTarget = standardizeTriple(target);
	const system = std.triple.archAndOs(standardizedHost);
	const hostOs = std.triple.os(system);
	let verbose = arg.verbose;

	const isCross =
		std.triple.arch(host) !== std.triple.arch(target) ||
		std.triple.os(host) !== std.triple.os(target);
	let prefix = ``;
	let suffix = tg``;
	if (hostOs === "linux" && isCross) {
		prefix = `${standardizedTarget}-`;
	}

	// Use the bootstrap shell and utils.
	const shellArtifact = await bootstrap.shell();
	const shell = await shellArtifact.get("bin/sh").then(tg.File.expect);
	const utilsArtifact = await bootstrap.utils();

	// Get the appropriate toolchain directory.
	// You need a build toolchian AND a host toolchain. These may be the same.
	let buildToolchain = undefined;
	let hostToolchain = undefined;
	let setSysroot = false;
	if (hostOs === "linux") {
		if (!isCross) {
			buildToolchain = await bootstrap.sdk.env(host);
			host = await bootstrap.toolchainTriple(host);
			target = host;
		} else {
			buildToolchain = await bootstrap.sdk.env(host);
			hostToolchain = await tg.build(gnu.toolchain, {
				host: system,
				target: standardizedTarget,
			});
		}
	} else {
		if (isCross) {
			buildToolchain = await bootstrap.sdk.env(host);
			hostToolchain = await tg
				.build(llvm.toolchain, {
					host: standardizedHost,
					target: standardizedTarget,
				})
				.then(tg.Directory.expect);
			const { directory: targetDirectory } = await std.sdk.toolchainComponents({
				env: await std.env.arg(hostToolchain, { utils: false }),
				host: host,
			});
			suffix = tg.Template
				.raw` -target ${standardizedTarget} --sysroot ${targetDirectory}/${standardizedTarget}/sysroot`;
		} else {
			buildToolchain = await bootstrap.sdk.env(host);
		}
	}

	const { directory, ldso, libDir } = await std.sdk.toolchainComponents({
		env: await std.env.arg(buildToolchain, { utils: false }),
		host: isCross ? standardizedHost : host,
	});
	if (setSysroot) {
		suffix = tg.Template.raw` --sysroot ${directory}`;
	}

	// Get the Rust toolchain.
	const rustToolchain = await tg.build(rust, { target: standardizedTarget });

	// Set up common environemnt.
	const certFile = tg`${std.caCertificates()}/cacert.pem`;

	const env: Array<tg.Unresolved<std.env.Arg>> = [
		{ utils: false },
		buildToolchain,
		hostToolchain ?? {},
		rustToolchain,
		shellArtifact,
		utilsArtifact,
		{
			SHELL: shell,
			SSL_CERT_FILE: certFile,
			CARGO_HTTP_CAINFO: certFile,
			RUST_TARGET: standardizedTarget,
			CARGO_REGISTRIES_CRATES_IO_PROTOCOL: "sparse",
			RUSTFLAGS: `-C target-feature=+crt-static`,
			[`CARGO_TARGET_${tripleToEnvVar(standardizedTarget, true)}_LINKER`]: tg`${prefix}cc${suffix}`,
			[`AR_${tripleToEnvVar(standardizedTarget)}`]: `${prefix}ar`,
			[`CC_${tripleToEnvVar(standardizedTarget)}`]: tg`${prefix}cc${suffix}`,
			[`CXX_${tripleToEnvVar(standardizedTarget)}`]: tg`${prefix}c++${suffix}`,
		},
	];

	if (hostOs === "darwin") {
		env.push({ MACOSX_DEPLOYMENT_TARGET: "15.2" });
	}

	// Set up platform-specific environment.
	let interpreter = tg``;
	let rustc = tg``;
	let cargo = tg``;
	if (hostOs === "linux") {
		interpreter = tg`${ldso} --library-path ${libDir}`;
		rustc = tg`${interpreter} ${rustToolchain}/bin/rustc`;
		cargo = tg`${interpreter} ${rustToolchain}/bin/cargo`;
	} else if (hostOs === "darwin") {
		rustc = tg`${rustToolchain}/bin/rustc`;
		cargo = tg`${rustToolchain}/bin/cargo`;

		const macOsSdk = bootstrap.macOsSdk();

		// https://github.com/rust-lang/cc-rs/issues/810
		const sdkroot = tg.directory({
			"MacOSX.sdk": macOsSdk,
		});

		if (isCross) {
			env.push({
				SDKROOT: tg.Mutation.unset(),
			});
		} else {
			env.push({
				SDKROOT: tg`${sdkroot}/MacOSX.sdk`,
			});
		}
	}

	// Define phases.
	let prepare = tg`
		export CARGO_HOME=$PWD/cargo_home
		mkdir -p $CARGO_HOME

		export TARGET=$PWD/target
		mkdir -p "$TARGET"

		echo "#!/usr/bin/env sh" > rustc.sh
		echo 'set -eu' >> rustc.sh
		echo 'exec ${rustc} "$@"' >> rustc.sh
		chmod +x rustc.sh
		export RUSTC=$PWD/rustc.sh
		`;
	if (hostOs === "darwin" && isCross) {
		const macOsSdk = bootstrap.macOsSdk();

		// https://github.com/rust-lang/cc-rs/issues/810
		const sdkroot = tg.directory({
			"MacOSX.sdk": macOsSdk,
		});
		const hostFlag = tg`--sysroot ${sdkroot}/MacOSX.sdk`;
		const { directory: targetDirectory } = await std.sdk.toolchainComponents({
			env: await std.env.arg(hostToolchain, { utils: false }),
			host: host,
		});
		suffix = tg.Template
			.raw` -target ${standardizedTarget} --sysroot ${directory}/${standardizedTarget}/sysroot`;
		prepare = tg`
			${prepare}
			echo "#!/usr/bin/env sh" > build-cc.sh
			echo 'set -eu' >> build-cc.sh
			echo 'exec ${directory}/bin/clang ${hostFlag} "$@"' >> build-cc.sh
			chmod +x build-cc.sh
			echo "#!/usr/bin/env sh" > target-cc.sh
			echo 'set -eu' >> target-cc.sh
			echo 'exec ${targetDirectory}/bin/clang -target ${standardizedTarget} --sysroot ${targetDirectory}/${standardizedTarget}/sysroot "$@"' >> target-cc.sh
			chmod +x target-cc.sh
			echo "#!/usr/bin/env sh" > build-cxx.sh
			echo 'set -eu' >> build-cxx.sh
			echo 'exec ${directory}/bin/clang++ ${hostFlag} "$@"' >> build-cxx.sh
			chmod +x build-cxx.sh
			export CC=$PWD/build-cc.sh
			export CXX=$PWD/build-cxx.sh
			export CARGO_TARGET_${tripleToEnvVar(standardizedHost, true)}_LINKER=$PWD/build-cc.sh
			export CARGO_TARGET_${tripleToEnvVar(standardizedTarget, true)}_LINKER=$PWD/target-cc.sh
			`;
	}

	const args = [
		tg`--manifest-path ${source}/Cargo.toml`,
		`--target-dir $TARGET`,
		`--target $RUST_TARGET`,
		`--all`,
		`--locked`,
	];
	if (release) {
		args.push(`--release`);
	}
	if (enableTracing) {
		args.push(`--features tracing`);
	}
	if (verbose) {
		args.push("--verbose");
	}

	const build = {
		command: tg`${cargo} build`,
		args,
	};

	const buildType = release ? "/release" : "/debug";

	const install = {
		pre: `mkdir -p $OUTPUT/bin`,
		body: `
			for item in cc_proxy ld_proxy strip_proxy wrapper ; do
				mv $TARGET/$RUST_TARGET${buildType}/tangram_$item $OUTPUT/bin/$item
			done
		`,
	};

	// Build and return.
	return await tg
		.build(std.phases.run, {
			bootstrap: true,
			env: std.env.arg(...env),
			phases: { prepare, build, install },
			command: {
				host: system,
			},
			checksum: "sha256:any",
			network: true,
		})
		.then(tg.Directory.expect);
};

/* Ensure the passed triples are what we expect, musl on linxu and standard for macOS. */
const standardizeTriple = (triple: string): string => {
	const components = std.triple.components(triple);
	const os = components.os;

	if (os === "darwin") {
		return std.triple.create({
			...components,
			vendor: "apple",
		});
	} else if (os === "linux") {
		return std.triple.create({
			...components,
			vendor: "unknown",
			environment: "musl",
		});
	} else {
		return tg.unreachable();
	}
};

const tripleToEnvVar = (triple: string, upcase?: boolean) => {
	const allCaps = upcase ?? false;
	let result = triple.replace(/-/g, "_");
	if (allCaps) {
		result = result.toUpperCase();
	}
	return result;
};

export const test = async () => {
	// Detect the host triple.
	const host = await bootstrap.toolchainTriple();

	// Determine the target triple with differing architecture from the host.
	const hostArch = std.triple.arch(host);
	tg.assert(hostArch);

	const nativeWorkspace = await tg.build(workspace, {
		host,
	});

	// Assert the native workspace was built for the host.
	const os = std.triple.os(std.triple.archAndOs(host));
	const nativeWrapper = await nativeWorkspace.get("bin/wrapper");
	tg.File.assert(nativeWrapper);
	const nativeMetadata = await std.file.executableMetadata(nativeWrapper);
	if (os === "linux") {
		tg.assert(nativeMetadata.format === "elf");
		tg.assert(nativeMetadata.arch === hostArch);
	} else if (os === "darwin") {
		tg.assert(nativeMetadata.format === "mach-o");
		tg.assert(nativeMetadata.arches.includes(hostArch));
	} else {
		return tg.unreachable();
	}
	return nativeWorkspace;
};

export const testCross = async () => {
	// Detect the host triple.
	const host = await std.triple.host();

	// Determine the target triple with differing architecture from the host.
	const hostArch = std.triple.arch(host);
	const targetArch = hostArch === "x86_64" ? "aarch64" : "x86_64";
	const target = std.triple.create({
		arch: targetArch,
		vendor: "unknown",
		os: "linux",
		environment: "gnu",
	});

	const crossWorkspace = await tg.build(workspace, {
		build: host,
		host: target,
		release: false,
	});

	// Assert the cross workspace was built for the target.
	const crossWrapper = await crossWorkspace.get("bin/wrapper");
	tg.File.assert(crossWrapper);
	const crossMetadata = await std.file.executableMetadata(crossWrapper);
	tg.assert(crossMetadata.format === "elf");
	tg.assert(crossMetadata.arch === targetArch);
	return true;
};
