import * as bootstrap from "../bootstrap.tg.ts";
import * as gcc from "../sdk/gcc.tg.ts";
import * as std from "../tangram.tg.ts";
import cargoToml from "../Cargo.toml" with { type: "file" };
import cargoLock from "../Cargo.lock" with { type: "file" };
import ccProxyDir from "../packages/cc_proxy" with { type: "directory" };
import ldProxyDir from "../packages/ld_proxy" with { type: "directory" };
import wrapperDir from "../packages/wrapper" with { type: "directory" };

type Arg = {
	buildToolchain: std.env.Arg;
	build?: string;
	host?: string;
	release?: boolean;
	source?: tg.Directory;
};

/** Build the binaries that enable Tangram's wrapping and environment composition strategy. */
export let workspace = tg.target(async (arg: Arg): Promise<tg.Directory> => {
	let {
		build: build_,
		buildToolchain,
		host: host_,
		release = true,
		source: source_,
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let buildTriple = build_ ?? host;

	// Get the source.
	let source = source_
		? source_
		: await tg.directory({
				"Cargo.toml": cargoToml,
				"Cargo.lock": cargoLock,
				"packages/cc_proxy": ccProxyDir,
				"packages/ld_proxy": ldProxyDir,
				"packages/wrapper": wrapperDir,
		  });

	return build({
		...(await std.triple.rotate({ build: buildTriple, host })),
		buildToolchain,
		release,
		source,
	});
});

export let tgcc = async (arg: Arg) =>
	tg.File.expect(await (await workspace(arg)).get("bin/cc_proxy"));

export let tgld = async (arg: Arg) =>
	tg.File.expect(await (await workspace(arg)).get("bin/ld_proxy"));

export let wrapper = async (arg: Arg) =>
	tg.File.expect(await (await workspace(arg)).get("bin/wrapper"));

let version = "1.79.0";

type ToolchainArg = {
	target?: string;
};

export let rust = tg.target(
	async (arg?: ToolchainArg): Promise<tg.Directory> => {
		let host = standardizeTriple(await std.triple.host());
		let target = standardizeTriple(arg?.target ?? host);
		let hostSystem = std.triple.archAndOs(host);

		// Download and parse the Rust manifest for the selected version.
		let manifestFile = await tg.file(
			await tg.download(
				`https://static.rust-lang.org/dist/channel-rust-${version}.toml`,
				"unsafe",
			),
		);
		tg.assert(manifestFile instanceof tg.File);
		let manifest = tg.encoding.toml.decode(
			await manifestFile.text(),
		) as RustupManifest;

		// Install the full minimal profile for the host.
		let packages = tg.directory();
		for (let name of manifest.profiles["minimal"] ?? []) {
			let pkg = manifest.pkg[name]?.target[host];
			if (pkg?.available) {
				let artifact = std.download({
					checksum: `sha256:${pkg.xz_hash}`,
					decompress: "xz",
					url: pkg.xz_url,
				});
				packages = tg.directory(packages, {
					[name]: artifact,
				});
			}
		}

		// If there is a target specified different from the host, install just the rust-std package for that target.
		if (host !== target) {
			let name = "rust-std";
			let pkg = manifest.pkg[name]?.target[target];
			if (pkg?.available) {
				let artifact = std.download({
					checksum: `sha256:${pkg.xz_hash}`,
					decompress: "xz",
					url: pkg.xz_url,
				});
				packages = tg.directory(packages, {
					[name]: artifact,
				});
			}
		}

		// Install the packages.
		let script = tg`
		for package in ${packages}/*/* ; do
			sh $package/install.sh --prefix="$OUTPUT"
			chmod -R +w "$OUTPUT"
		done
	`;

		let env = bootstrap.sdk.env(host);

		return tg.Directory.expect(
			await std.phases.build({
				target: { host: hostSystem },
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

export let build = async (arg: BuildArg) => {
	let enableTracing = arg.enableTracingFeature ?? true;
	let release = arg.release ?? true;
	let source = arg.source;
	let host_ = arg.host ?? (await std.triple.host());
	let host = standardizeTriple(host_);
	let target_ = arg.target ?? host;
	let target = standardizeTriple(target_);
	let system = std.triple.archAndOs(host);
	let os = std.triple.os(system);

	let isCross =
		std.triple.arch(host_) !== std.triple.arch(target_) ||
		std.triple.os(host_) !== std.triple.os(target_);
	let prefix = ``;
	let suffix = tg``;
	if (isCross) {
		prefix = `${target}-`;
	}

	// Use the bootstrap shell and utils.
	let shellArtifact = await bootstrap.shell();
	let shell = await shellArtifact.get("bin/sh").then(tg.File.expect);
	let utilsArtifact = await bootstrap.utils();

	// Get the appropriate toolchain directory.
	let buildToolchain = arg.buildToolchain;
	let setSysroot = false;
	if (os === "linux") {
		if (!isCross) {
			buildToolchain = await bootstrap.sdk.env(host_);
			host_ = await bootstrap.toolchainTriple(host_);
			target_ = host_;
		} else {
			buildToolchain = await gcc.toolchain({ host, target });
			setSysroot = true;
		}
	} else {
		if (isCross) {
			buildToolchain = await gcc.toolchain({ host, target });
		} else {
			buildToolchain = await bootstrap.sdk.env(host_);
		}
	}

	let { directory, ldso, libDir } = await std.sdk.toolchainComponents({
		env: buildToolchain,
		host: isCross ? host : host_,
		target: isCross ? target : target_,
	});
	if (setSysroot) {
		suffix = tg` --sysroot ${directory}`;
	}

	// Get the Rust toolchain.
	let rustToolchain = await rust({ target });

	// Set up common environemnt.
	let certFile = tg`${std.caCertificates()}/cacert.pem`;

	let env: tg.Unresolved<std.Args<std.env.Arg>> = [
		buildToolchain,
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

	// On macOS, if cross-compiling, include the default SDK as well.
	if (os === "darwin" && isCross) {
		env.push(std.sdk());
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

		let macOsSdk = bootstrap.macOsSdk();

		// https://github.com/rust-lang/cc-rs/issues/810
		let sdkroot = tg.directory({
			"MacOSX.sdk": macOsSdk,
		});

		env.push({
			SDKROOT: tg`${sdkroot}/MacOSX.sdk`,
		});
	}

	// Define phases.
	let prepare = tg`
		export CARGO_HOME=$PWD/cargo_home
		mkdir -p $CARGO_HOME

		export TARGET=$PWD/target
		mkdir -p "$TARGET"

		echo "#!/usr/bin/env sh" > rustc.sh
		echo 'set -eu' >> rustc.sh
		echo '${rustc} $@' >> rustc.sh
		chmod +x rustc.sh
		export RUSTC=$PWD/rustc.sh
		`;

	let args = [
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

	let build = {
		command: tg`${cargo} build`,
		args,
	};

	let buildType = release ? "/release" : "/debug";

	let install = {
		pre: `mkdir -p $OUTPUT/bin`,
		body: `
			mv $TARGET/$RUST_TARGET${buildType}/tangram_cc_proxy $OUTPUT/bin/cc_proxy
			mv $TARGET/$RUST_TARGET${buildType}/tangram_ld_proxy $OUTPUT/bin/ld_proxy
			mv $TARGET/$RUST_TARGET${buildType}/tangram_wrapper $OUTPUT/bin/wrapper
		`,
	};

	// Build and return.
	return tg.Directory.expect(
		await std.phases.build({
			env: std.env.arg(env),
			phases: { prepare, build, install },
			target: {
				host: system,
				checksum: "unsafe",
			},
		}),
	);
};

/* Ensure the passed triples are what we expect, musl on linxu and standard for macOS. */
let standardizeTriple = (triple: string): string => {
	let components = std.triple.components(triple);
	let os = components.os;

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

let tripleToEnvVar = (triple: string, upcase?: boolean) => {
	let allCaps = upcase ?? false;
	let result = triple.replace(/-/g, "_");
	if (allCaps) {
		result = result.toUpperCase();
	}
	return result;
};

export let test = tg.target(async () => {
	// Detect the host triple.
	let host = await std.triple.host();

	// Determine the target triple with differing architecture from the host.
	let hostArch = std.triple.arch(host);
	tg.assert(hostArch);

	let buildToolchain = bootstrap.sdk.env(host);

	let nativeWorkspace = await workspace({
		buildToolchain,
		host,
	});

	// Assert the native workspace was built for the host.
	let os = std.triple.os(std.triple.archAndOs(host));
	let nativeWrapper = await nativeWorkspace.get("bin/wrapper");
	tg.File.assert(nativeWrapper);
	let nativeMetadata = await std.file.executableMetadata(nativeWrapper);
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

export let testCross = tg.target(async () => {
	// Detect the host triple.
	let host = await std.triple.host();

	// Determine the target triple with differing architecture from the host.
	let hostArch = std.triple.arch(host);
	let targetArch = hostArch === "x86_64" ? "aarch64" : "x86_64";
	let target = std.triple.create({
		arch: targetArch,
		vendor: "unknown",
		os: "linux",
		environment: "gnu",
	});
	let buildToolchain = gcc.toolchain({ host, target });

	let crossWorkspace = await workspace({
		buildToolchain,
		build: host,
		host: target,
		release: false,
	});

	// Assert the cross workspace was built for the target.
	let crossWrapper = await crossWorkspace.get("bin/wrapper");
	tg.File.assert(crossWrapper);
	let crossMetadata = await std.file.executableMetadata(crossWrapper);
	tg.assert(crossMetadata.format === "elf");
	tg.assert(crossMetadata.arch === targetArch);
	return true;
});
