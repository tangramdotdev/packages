import * as bootstrap from "../bootstrap.tg.ts";
import * as gnu from "../sdk/gnu.tg.ts";
import * as std from "../tangram.ts";
import cargoToml from "../Cargo.toml" with { type: "file" };
import cargoLock from "../Cargo.lock" with { type: "file" };
import packages from "../packages" with { type: "directory" };

type Arg = {
	buildToolchain: std.env.Arg;
	build?: string;
	host?: string;
	release?: boolean;
	source?: tg.Directory;
};

/** Build the binaries that enable Tangram's wrapping and environment composition strategy. */
export const workspace = tg.command(
	async (arg?: Arg): Promise<tg.Directory> => {
		const {
			build: build_,
			buildToolchain,
			host: host_,
			release = true,
			source: source_,
		} = arg ?? {};
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

		return build({
			...(await std.triple.rotate({ build: buildTriple, host })),
			buildToolchain,
			release,
			source,
		});
	},
);

export const ccProxy = (arg?: Arg) =>
	workspace(arg)
		.then((dir) => dir.get("bin/cc_proxy"))
		.then(tg.File.expect);

export const ldProxy = (arg?: Arg) =>
	workspace(arg)
		.then((dir) => dir.get("bin/ld_proxy"))
		.then(tg.File.expect);

export const stripProxy = (arg?: Arg) =>
	workspace(arg)
		.then((dir) => dir.get("bin/strip_proxy"))
		.then(tg.File.expect);

export const wrapper = (arg?: Arg) =>
	workspace(arg)
		.then((dir) => dir.get("bin/wrapper"))
		.then(tg.File.expect);

type ToolchainArg = {
	target?: string;
};

export const rust = tg.command(
	async (arg?: ToolchainArg): Promise<tg.Directory> => {
		const host = standardizeTriple(await std.triple.host());
		const target = standardizeTriple(arg?.target ?? host);
		const hostSystem = std.triple.archAndOs(host);

		// Download and parse the Rust manifest for the selected version.
		const version = "1.86.0";
		const manifestBlob = (await tg
			.download(
				`https://static.rust-lang.org/dist/channel-rust-${version}.toml`,
				"sha256:5ffe190473b7896d1f39e9d0ddfa04bec72000f25897669bb296814e10ceba42",
			)
			.then(tg.Blob.expect)) as tg.Blob;
		const manifestFile = await tg.file(manifestBlob);
		const manifest = tg.encoding.toml.decode(
			await manifestFile.text(),
		) as RustupManifest;

		// Install the full minimal profile for the host.
		let packages = tg.directory();
		for (const name of manifest.profiles["minimal"] ?? []) {
			const pkg = manifest.pkg[name]?.target[host];
			if (pkg?.available) {
				const artifact = std.download({
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
				const artifact = std.download({
					checksum: `sha256:${pkg.xz_hash}`,
					url: pkg.xz_url,
				});
				packages = tg.directory(packages, {
					[name]: artifact,
				});
			}
		}

		// Install the packages.
		const script = tg`
		for package in ${packages}/*/* ; do
			sh $package/install.sh --prefix="$OUTPUT"
			chmod -R +w "$OUTPUT"
		done
	`;

		const env = bootstrap.sdk.env(host);

		return tg.Directory.expect(
			await std.phases.run({
				command: { host: hostSystem },
				phases: { build: script },
				env,
			}),
		);
	},
);

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
	buildToolchain?: std.env.Arg;
	enableTracingFeature?: boolean;
	host?: string;
	release?: boolean;
	source: tg.Directory;
	target?: string;
};

export const build = async (arg: BuildArg) => {
	const enableTracing = arg.enableTracingFeature ?? true;
	const release = arg.release ?? true;
	const source = arg.source;
	let host_ = arg.host ?? (await std.triple.host());
	const host = standardizeTriple(host_);
	let target_ = arg.target ?? host;
	const target = standardizeTriple(target_);
	const system = std.triple.archAndOs(host);
	const os = std.triple.os(system);

	const isCross =
		std.triple.arch(host_) !== std.triple.arch(target_) ||
		std.triple.os(host_) !== std.triple.os(target_);
	let prefix = ``;
	let suffix = tg``;
	if (isCross) {
		prefix = `${target}-`;
	}

	// Use the bootstrap shell and utils.
	const shellArtifact = await bootstrap.shell();
	const shell = await shellArtifact.get("bin/sh").then(tg.File.expect);
	const utilsArtifact = await bootstrap.utils();

	// Get the appropriate toolchain directory.
	// You need a build toolchian AND a host toolchain. These may be the same.
	let buildToolchain = arg.buildToolchain;
	let hostToolchain = undefined;
	let setSysroot = false;
	if (os === "linux") {
		if (!isCross) {
			buildToolchain = await bootstrap.sdk.env(host_);
			host_ = await bootstrap.toolchainTriple(host_);
			target_ = host_;
		} else {
			buildToolchain = await bootstrap.sdk.env(host_);
			hostToolchain = await gnu.toolchain({ host, target });
			setSysroot = true;
		}
	} else {
		if (isCross) {
			buildToolchain = await bootstrap.sdk.env(host_);
			hostToolchain = await gnu.toolchain({ host, target });
		} else {
			buildToolchain = await bootstrap.sdk.env(host_);
		}
	}

	const { directory, ldso, libDir } = await std.sdk.toolchainComponents({
		env: buildToolchain,
		host: isCross ? host : host_,
	});
	if (setSysroot) {
		suffix = tg.Template.raw` --sysroot ${directory}`;
	}

	// Get the Rust toolchain.
	const rustToolchain = await rust({ target });

	// Set up common environemnt.
	const certFile = tg`${std.caCertificates()}/cacert.pem`;

	const env: tg.Unresolved<std.Args<std.env.Arg>> = [
		buildToolchain,
		hostToolchain ?? {},
		rustToolchain,
		shellArtifact,
		utilsArtifact,
		{
			SHELL: shell,
			SSL_CERT_FILE: certFile,
			CARGO_HTTP_CAINFO: certFile,
			RUST_TARGET: target,
			CARGO_REGISTRIES_CRATES_IO_PROTOCOL: "sparse",
			RUSTFLAGS: `-C target-feature=+crt-static`,
			[`CARGO_TARGET_${tripleToEnvVar(target, true)}_LINKER`]: `${prefix}cc`,
			[`AR_${tripleToEnvVar(target)}`]: `${prefix}ar`,
			[`CC_${tripleToEnvVar(target)}`]: tg`${prefix}cc${suffix}`,
			[`CXX_${tripleToEnvVar(target)}`]: tg`${prefix}c++${suffix}`,
		},
	];

	if (os === "darwin") {
		env.push({ MACOSX_DEPLOYMENT_TARGET: "15.2" });
		// On macOS, if cross-compiling, include the default SDK as well.
		if (isCross) {
			env.push(std.sdk());
		}
	}

	// Set up platform-specific environment.
	let interpreter = tg``;
	let rustc = tg``;
	let cargo = tg``;
	if (os === "linux") {
		interpreter = tg`${ldso} --library-path ${libDir}`;
		rustc = tg`${interpreter} ${rustToolchain}/bin/rustc`;
		cargo = tg`${interpreter} ${rustToolchain}/bin/cargo`;
	} else if (os === "darwin") {
		rustc = tg`${rustToolchain}/bin/rustc`;
		cargo = tg`${rustToolchain}/bin/cargo`;

		const macOsSdk = bootstrap.macOsSdk();

		// https://github.com/rust-lang/cc-rs/issues/810
		const sdkroot = tg.directory({
			"MacOSX.sdk": macOsSdk,
		});

		env.push({
			SDKROOT: tg`${sdkroot}/MacOSX.sdk`,
		});
	}

	// Define phases.
	const prepare = tg`
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
	return tg.Directory.expect(
		await std.phases.run({
			env: std.env.arg(env),
			phases: { prepare, build, install },
			command: {
				host: system,
			},
			checksum: "any",
			network: true,
		}),
	);
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

export const test = tg.command(async () => {
	// Detect the host triple.
	const host = await std.triple.host();

	// Determine the target triple with differing architecture from the host.
	const hostArch = std.triple.arch(host);
	tg.assert(hostArch);

	const buildToolchain = bootstrap.sdk.env(host);

	const nativeWorkspace = await workspace({
		buildToolchain,
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
});

export const testCross = tg.command(async () => {
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
	const buildToolchain = gnu.toolchain({ host, target });

	const crossWorkspace = await workspace({
		buildToolchain,
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
});
