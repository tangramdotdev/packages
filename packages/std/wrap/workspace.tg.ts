import * as bootstrap from "../bootstrap.tg.ts";
import * as gcc from "../sdk/gcc.tg.ts";
import * as std from "../tangram.tg.ts";

type Arg = std.sdk.BuildEnvArg & {
	release?: boolean;
};

/** Build Tangram-in-Tangram, producing the binaries that enable Tangram's wrapping and environment composition strategy. */
export let workspace = tg.target(async (arg?: Arg): Promise<tg.Directory> => {
	let { build: build_, host: host_, release = true, sdk: sdkArg } = arg ?? {};
	let host = host_ ? tg.triple(host_) : await tg.Triple.host();
	let buildTriple = build_ ? tg.triple(build_) : host;

	// Get the source.
	let source = await tg.directory({
		"Cargo.toml": tg.include("../Cargo.toml"),
		"Cargo.lock": tg.include("../Cargo.lock"),
		"packages/env": tg.include("../packages/env"),
		"packages/cc_proxy": tg.include("../packages/cc_proxy"),
		"packages/ld_proxy": tg.include("../packages/ld_proxy"),
		"packages/wrapper": tg.include("../packages/wrapper"),
	});

	return build({
		release,
		source,
		...(await tg.Triple.rotate({ build: buildTriple, host })),
		sdkArg,
	});
});

export let env = async (arg?: Arg) =>
	tg.File.expect(await (await workspace(arg)).get("bin/env"));

export let tgcc = async (arg?: Arg) =>
	tg.File.expect(await (await workspace(arg)).get("bin/cc_proxy"));

export let tgld = async (arg?: Arg) =>
	tg.File.expect(await (await workspace(arg)).get("bin/ld_proxy"));

export let wrapper = async (arg?: Arg) =>
	tg.File.expect(await (await workspace(arg)).get("bin/wrapper"));

let version = "1.76.0";

type ToolchainArg = {
	target?: tg.Triple.Arg;
};

export let rust = tg.target(
	async (arg?: ToolchainArg): Promise<tg.Directory> => {
		let host = await tg.Triple.host();
		let target = tg.triple(arg?.target ?? host);
		let hostSystem = tg.Triple.archAndOs(host);
		let os = tg.Triple.os(hostSystem);

		// Download and parse the Rust manifest for the selected version.
		let manifestFile = await tg.file(
			await tg.download(
				`https://static.rust-lang.org/dist/channel-rust-${version}.toml`,
				"unsafe",
			),
		);
		tg.assert(tg.File.is(manifestFile));
		let manifest = tg.encoding.toml.decode(
			await manifestFile.text(),
		) as RustupManifest;

		// On Linux, ensure we use a musl target for the host.
		if (os === "linux") {
			let hostArch = tg.Triple.arch(host);
			tg.assert(hostArch);
			host = tg.triple({
				arch: hostArch,
				vendor: "unknown",
				os: "linux",
				environment: "musl",
			});
		}

		// Install the full minimal profile for the host.
		let hostTripleString = tg.Triple.toString(host);
		let packages = tg.directory();
		for (let name of manifest.profiles["minimal"] ?? []) {
			let pkg = manifest.pkg[name]?.target[hostTripleString];
			if (pkg?.available) {
				let artifact = std.download({
					checksum: `sha256:${pkg.xz_hash}`,
					unpackFormat: ".tar.xz" as const,
					url: pkg.xz_url,
				});
				packages = tg.directory(packages, {
					[name]: artifact,
				});
			}
		}

		// If there is a target specified different from the host, install just the rust-std package for that target.
		if (!tg.Triple.eq(host, target)) {
			let name = "rust-std";
			let pkg = manifest.pkg[name]?.target[tg.Triple.toString(target)];
			if (pkg?.available) {
				let artifact = std.download({
					checksum: `sha256:${pkg.xz_hash}`,
					unpackFormat: ".tar.xz" as const,
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
	release?: boolean;
	source: tg.Directory;
	host: tg.Triple.Arg;
	target?: tg.Triple.Arg;
	sdkArg?: tg.MaybeNestedArray<std.sdk.Arg>;
};

export let build = async (arg: BuildArg) => {
	let release = arg.release ?? true;
	let source = arg.source;
	let host = tg.triple(arg.host);
	let system = tg.Triple.archAndOs(host);
	let os = tg.Triple.os(system);
	tg.assert(os);

	let target = arg.target ? tg.triple(arg.target) : host;
	let targetString = tg.Triple.toString(target);

	// On Linux, ensure we use a musl host/target.
	if (os === "linux") {
		let hostArch = tg.Triple.arch(host);
		tg.assert(hostArch);
		host = tg.triple({
			arch: hostArch,
			vendor: "unknown",
			os: "linux",
			environment: "musl",
		});

		let targetArch = tg.Triple.arch(target);
		tg.assert(targetArch);
		target = tg.triple({
			arch: targetArch,
			vendor: "unknown",
			os: "linux",
			environment: "musl",
		});
	}
	let isBootstrap = std
		.flatten([arg?.sdkArg])
		.some((sdk) => sdk?.bootstrapMode);


	let isCross = !tg.Triple.eq(host, target);

	// Get the SDK, without proxying enabled.
	let sdkArg: std.sdk.Arg = { host, target };
	if (host.arch === target.arch) {
		sdkArg = { ...sdkArg, bootstrapMode: true };
	}
	let sdk = await std.sdk(sdkArg, arg.sdkArg, { proxy: false });
	let { directory: buildToolchain } = await std.sdk.toolchainComponents({
		env: sdk,
	});

	let crossToolchain = await tg.directory();
	if (isCross && !isBootstrap) {
		crossToolchain = await gcc.toolchain({ host, target });
	}

	// Get the Rust toolchain.
	let rustToolchain = await rust({ target });

	// Set up common environemnt.
	let certFile = tg`${std.caCertificates()}/cacert.pem`;
	let prefix = ``;
	if (isCross && !isBootstrap) {
		prefix = `${targetString}-`;
	}

	let env: tg.Unresolved<Array<std.env.Arg>> = [
		sdk,
		crossToolchain,
		rustToolchain,
		{
			SSL_CERT_FILE: certFile,
			CARGO_HTTP_CAINFO: certFile,
			RUST_TARGET: tg.Triple.toString(target),
			CARGO_REGISTRIES_CRATES_IO_PROTOCOL: "sparse",
			RUSTFLAGS: `-C target-feature=+crt-static`,
			[`CARGO_TARGET_${tripleToEnvVar(target, true)}_LINKER`]: `${prefix}gcc`,
			[`AR_${tripleToEnvVar(target)}`]: `${prefix}ar`,
			[`CC_${tripleToEnvVar(target)}`]: `${prefix}gcc`,
			[`CXX_${tripleToEnvVar(target)}`]: `${prefix}g++`,
		},
	];

	// Set up platform-specific environment.
	let interpreter = tg``;
	let rustc = tg``;
	let cargo = tg``;
	if (os === "linux") {
		let ldso = tg`lib/${bootstrap.interpreterName(host)}`;
		interpreter = tg`${buildToolchain}/${ldso} --library-path ${buildToolchain}/lib`;
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

	let build = {
		command: tg`${cargo} build`,
		args,
	};

	let buildType = "release";

	let install = {
		pre: `mkdir -p $OUTPUT/bin`,
		body: `
			mv $TARGET/$RUST_TARGET/${buildType}/tangram_env $OUTPUT/bin/env
			mv $TARGET/$RUST_TARGET/${buildType}/tangram_cc_proxy $OUTPUT/bin/cc_proxy
			mv $TARGET/$RUST_TARGET/${buildType}/tangram_ld_proxy $OUTPUT/bin/ld_proxy
			mv $TARGET/$RUST_TARGET/${buildType}/tangram_wrapper $OUTPUT/bin/wrapper
		`,
	};

	// Build and return.
	return tg.Directory.expect(
		await std.phases.build({
			env,
			phases: { prepare, build, install },
			target: {
				host: system,
				checksum: "unsafe",
			},
		}),
	);
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
	// Detect the host triple.
	let host = await tg.Triple.host();

	// Determine the target triple with differing architecture from the host.
	let hostArch = host.arch as string;

	let nativeWorkspace = await workspace({
		host,
		sdk: { bootstrapMode: true },
	});

	// Assert the native workspace was built for the host.
	let os = tg.Triple.os(tg.Triple.archAndOs(host));
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

	let crossWorkspace = await workspace({
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
