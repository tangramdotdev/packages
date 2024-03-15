import * as bootstrap from "../bootstrap.tg.ts";
import * as gcc from "../sdk/gcc.tg.ts";
import * as std from "../tangram.tg.ts";

type Arg = {
	buildToolchain: std.env.Arg;
	build?: tg.Triple.Arg;
	host?: tg.Triple.Arg;
	release?: boolean;
	source?: tg.Directory;
};

/** Build Tangram-in-Tangram, producing the binaries that enable Tangram's wrapping and environment composition strategy. */
export let workspace = tg.target(async (arg: Arg): Promise<tg.Directory> => {
	let {
		build: build_,
		buildToolchain,
		host: host_,
		release = true,
		source: source_,
	} = arg ?? {};
	let host = host_ ? tg.triple(host_) : await tg.Triple.host();
	let buildTriple = build_ ? tg.triple(build_) : host;

	// Get the source.
	let source = source_
		? source_
		: await tg.directory({
				"Cargo.toml": tg.include("../Cargo.toml"),
				"Cargo.lock": tg.include("../Cargo.lock"),
				"packages/cc_proxy": tg.include("../packages/cc_proxy"),
				"packages/ld_proxy": tg.include("../packages/ld_proxy"),
				"packages/wrapper": tg.include("../packages/wrapper"),
			});

	return build({
		...(await tg.Triple.rotate({ build: buildTriple, host })),
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

let version = "1.76.0";

type ToolchainArg = {
	target?: tg.Triple.Arg;
};

export let rust = tg.target(
	async (arg?: ToolchainArg): Promise<tg.Directory> => {
		let host = standardizeTriple(await tg.Triple.host());
		let target = standardizeTriple(arg?.target ?? host);
		let hostSystem = tg.Triple.archAndOs(host);

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
	buildToolchain?: std.env.Arg;
	host?: tg.Triple.Arg;
	release?: boolean;
	source: tg.Directory;
	target?: tg.Triple.Arg;
};

export let build = async (arg: BuildArg) => {
	let release = arg.release ?? true;
	let source = arg.source;
	let host = standardizeTriple(
		arg.host ? tg.triple(arg.host) : await tg.Triple.host(),
	);
	let target = standardizeTriple(arg.target ? tg.triple(arg.target) : host);
	let system = tg.Triple.archAndOs(host);
	let os = tg.Triple.os(system);

	let targetString = tg.Triple.toString(target);

	let isCross = !tg.Triple.eq(host, target);

	// Get the toolchain directory.
	let { ldso, libDir } = await std.sdk.toolchainComponents({
		bootstrapMode: true,
		env: arg.buildToolchain,
		host,
		target,
	});

	// Get the Rust toolchain.
	let rustToolchain = await rust({ target });

	// Set up common environemnt.
	let certFile = tg`${std.caCertificates()}/cacert.pem`;
	let prefix = ``;
	if (isCross) {
		prefix = `${targetString}-`;
	}

	let env: tg.Unresolved<Array<std.env.Arg>> = [
		arg.buildToolchain,
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
	} else {
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
			env,
			phases: { prepare, build, install },
			target: {
				host: system,
				checksum: "unsafe",
			},
		}),
	);
};

/* Ensure the passed triples are what we expect, musl on linxu and standard for macOS. */
let standardizeTriple = (tripleArg: tg.Triple.Arg): tg.Triple => {
	let triple = tg.triple(tripleArg);
	let hostArch = tg.Triple.arch(triple);
	let os = tg.Triple.os(triple);

	if (os === "darwin") {
		return tg.triple({
			arch: hostArch,
			vendor: "apple",
			os: "darwin",
		});
	} else if (os === "linux") {
		return tg.triple({
			arch: hostArch,
			vendor: "unknown",
			os: "linux",
			environment: "musl",
		});
	} else {
		return tg.unreachable();
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
	// Detect the host triple.
	let host = await tg.Triple.host();

	// Determine the target triple with differing architecture from the host.
	let hostArch = tg.Triple.arch(host);
	tg.assert(hostArch);

	let buildToolchain = bootstrap.sdk.env(host);

	let nativeWorkspace = await workspace({
		buildToolchain,
		host,
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
