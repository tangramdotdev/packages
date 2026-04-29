import * as std from "std" with { source: "../std" };
import { $ } from "std" with { source: "../std" };
import openssl from "openssl" with { source: "../openssl.tg.ts" };
import pkgconf from "pkgconf" with { source: "../pkgconf.tg.ts" };
import * as proxy_ from "./proxy.tg.ts";
import { rustTriple, self } from "./tangram.ts";

/** Fields shared between sandboxed `build()` and unsandboxed `run()`. */
type CommonArg = {
	/** The machine performing the compilation. */
	build?: string;

	/** Toolchain channel: "stable" (default), "nightly", or "nightly-YYYY-MM-DD". When proxy is enabled, defaults to "nightly". */
	channel?: "stable" | "nightly" | string;

	/** Dependencies configuration. When provided, deps are resolved to env automatically. */
	deps?: std.deps.ConfigArg | undefined;

	/** Dependency argument overrides. Keys must match deps config keys. */
	dependencies?: std.packages.ResolvedDependencyArgs | undefined;

	/** Environment variables to set during the build. */
	env?: std.env.Arg;

	/** Machine that will run the compilation. */
	host?: string;

	/** Parent of the directory containing the Cargo.toml relative to the source dir if not at the expected location. */
	manifestSubdir?: string;

	/** Number of parallel jobs to use. */
	parallelJobs?: number;

	/** Additional script to run prior to the build. */
	pre?: tg.Template.Arg;

	/** Whether to use the tangram_rustc proxy. */
	proxy?: boolean;

	/** SDK configuration to use during the build. */
	sdk?: std.sdk.Arg;

	/** Source directory. */
	source?: tg.Directory;

	/** Environment to propagate to all dependencies in the subtree. */
	subtreeEnv?: std.env.Arg;

	/** SDK configuration to propagate to all dependencies in the subtree. */
	subtreeSdk?: std.sdk.Arg;

	/** Target triple for the build. */
	target?: string;

	/** Should the default features get disabled? Default: false. */
	disableDefaultFeatures?: boolean;

	/** Features to enable during the build. */
	features?: Array<string>;

	/** Whether to use cargo vendor instead of the Tangram-native vendoring. */
	useCargoVendor?: boolean;
};

export type Arg = CommonArg & {
	/** By default, cargo builds compile "out-of-tree", creating build artifacts in a mutable working directory but referring to an immutable source. Enabling `buildInTree` will instead first copy the source directory into the working build directory. Default: false. */
	buildInTree?: boolean;

	/** Capture cargo stderr to a file in the output. Useful for parsing tgrustc tracing output in tests. Default: false. */
	captureStderr?: boolean;

	/** If the build requires network access, provide a checksum or the string "any" to accept any result. */
	checksum?: tg.Checksum;

	/** Disable the tgrustc per-build path→artifact-id cache. Default: false. */
	disableCheckinCache?: boolean;

	/** Should this build have network access? Must set a checksum to enable. Default: false. */
	network?: boolean;

	/** Should the build environment include pkg-config? Default: true. */
	pkgConfig?: boolean;

	/** The cargo build profile to use. Default: "release". */
	profile?: string;

	/** A name for the build process. */
	processName?: string;

	/** Whether to generate a cargo timing report. Adds `--timings` to the cargo build command and includes the `cargo-timings/` directory in the output. Default: false. */
	timings?: boolean;

	/** Whether to enable verbose logging. */
	verbose?: boolean;
};

/** The result of arg() - an Arg with build, host, and source guaranteed to be resolved. */
export type ResolvedArg = Omit<Arg, "build" | "host" | "source"> & {
	build: string;
	host: string;
	source: tg.Directory;
};

/** Resolve cargo args to a mutable arg object. Returns an Arg with build, host, and source guaranteed to be resolved. */
export const arg = async (...args: std.Args<Arg>): Promise<ResolvedArg> => {
	const collect = await std.args.apply<Arg, Arg>({
		args,
		map: async (arg) => arg,
		reduce: {
			env: (a, b) => std.env.arg(a, b),
			features: "append",
			sdk: (a, b) => std.sdk.arg(a, b),
			subtreeEnv: (a, b) => std.env.arg(a, b),
			subtreeSdk: (a, b) => std.sdk.arg(a, b),
		},
	});

	const { build: build_, host: host_, source, ...rest } = collect;

	tg.assert(source !== undefined, "source must be defined");

	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	return {
		build,
		host,
		source,
		...rest,
	};
};

export type RunArg = CommonArg & {
	/** Cargo.lock file for vendoring (alternative to providing full source). */
	cargoLock?: tg.File;

	/** When proxy is true, whether workspace members should be compiled directly via passthrough. Default: true. */
	passthrough?: boolean;
};

/** The result of runArg() - a RunArg with build and host guaranteed to be resolved. */
export type ResolvedRunArg = Omit<RunArg, "build" | "host"> & {
	build: string;
	host: string;
};

/** Resolve run args to a mutable arg object. Returns a RunArg with build and host guaranteed to be resolved. */
export const runArg = async (
	...args: std.Args<RunArg>
): Promise<ResolvedRunArg> => {
	const collect = await std.args.apply<RunArg, RunArg>({
		args,
		map: async (arg) => arg,
		reduce: {
			env: (a, b) => std.env.arg(a, b),
			features: "append",
			sdk: (a, b) => std.sdk.arg(a, b),
			subtreeEnv: (a, b) => std.env.arg(a, b),
			subtreeSdk: (a, b) => std.sdk.arg(a, b),
		},
	});

	const { build: build_, host: host_, ...rest } = collect;

	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	return {
		build,
		host,
		...rest,
	};
};

/** Resolve deps configuration to env, merging with any existing env arg. */
const resolveDepsEnv = async (
	resolved: CommonArg & { build: string; host: string },
) => {
	const depsConfig = await std.deps.resolveConfig(resolved.deps);
	if (!depsConfig) return resolved.env;
	return std.deps.env(depsConfig, {
		build: resolved.build,
		host: resolved.host,
		sdk: resolved.sdk,
		dependencies: resolved.dependencies,
		env: resolved.env,
		subtreeEnv: resolved.subtreeEnv,
		subtreeSdk: resolved.subtreeSdk,
	});
};

export async function run(...args: std.Args<RunArg>): Promise<tg.Command> {
	const resolved = await runArg(...args);
	const depsEnv = await resolveDepsEnv(resolved);

	const {
		cargoLock,
		channel: channel_,
		disableDefaultFeatures = false,
		features = [],
		host,
		manifestSubdir,
		parallelJobs,
		passthrough = true,
		pre,
		proxy = false,
		source,
		target: target_,
		useCargoVendor = false,
	} = resolved;
	const rustHost = rustTriple(host);
	const target = target_ ? rustTriple(target_) : rustHost;
	const crossCompiling = target !== rustHost;

	let vendorSetup: string | tg.Template = "";
	if (cargoLock || useCargoVendor) {
		let cargoConfig: tg.Template;
		if (useCargoVendor) {
			tg.assert(source, "source is required when useCargoVendor is true");
			const manifests = await tg.build(extractCargoManifests, source);
			cargoConfig = await tg.build(vendoredSources, {
				manifestSubdir,
				source: manifests,
				useCargoVendor: true,
			});
		} else {
			let lockFile: tg.File;
			if (cargoLock) {
				lockFile = cargoLock;
			} else {
				tg.assert(source, "source or cargoLock must be provided for vendoring");
				const sourcePath = manifestSubdir
					? await source.get(manifestSubdir).then(tg.Directory.expect)
					: source;
				lockFile = await sourcePath.get("Cargo.lock").then(tg.File.expect);
			}
			const vendoredDir = await tg.build(vendorDependencies, lockFile);
			cargoConfig = await tg`
[source.crates-io]
replace-with = "vendored-sources"

[source.vendored-sources]
directory = "${vendoredDir}"`;
		}
		vendorSetup = await tg`export CARGO_HOME="$(mktemp -d)"
mkdir -p "$CARGO_HOME"
cat > "$CARGO_HOME/config.toml" << 'VENDORCFG'
${cargoConfig}
VENDORCFG`;
	}

	const exports: Array<string> = [
		`export RUST_TARGET="${target}"`,
		`export CARGO_REGISTRIES_CRATES_IO_PROTOCOL="sparse"`,
		`export TANGRAM_HOST="${std.triple.archAndOs(rustHost)}"`,
	];

	if (crossCompiling) {
		exports.push(`export CARGO_BUILD_TARGET="${target}"`);

		const envVar = tripleToEnvVar(target, true);
		exports.push(`export CARGO_TARGET_${envVar}_LINKER="${target}-cc"`);
		exports.push(`export AR_${tripleToEnvVar(target)}="${target}-ar"`);
		exports.push(`export CC_${tripleToEnvVar(target)}="${target}-cc"`);
		exports.push(`export CXX_${tripleToEnvVar(target)}="${target}-c++"`);
	}

	{
		const effectiveJobs = parallelJobs ?? (proxy ? 256 : undefined);
		if (effectiveJobs !== undefined) {
			exports.push(`export CARGO_BUILD_JOBS="${effectiveJobs}"`);
		}
	}

	// Lets the proxy detect workspace members and route them to passthrough;
	// cargo sets cwd per-crate so current_dir alone is insufficient.
	const passthroughSetup = proxy
		? 'export TGRUSTC_PASSTHROUGH_PROJECT_DIR="$PWD"'
		: "";

	let proxySetup: string | tg.Template = "";
	if (proxy) {
		const proxyDir = proxy_.proxy();
		const proxyBin = proxyDir
			.then((d) => d.get("bin/tgrustc"))
			.then(tg.File.expect);
		if (!channel_ && !source) {
			throw new Error(
				"When proxy mode is enabled, provide a 'source' directory or 'channel' argument to determine the Rust toolchain channel.",
			);
		}
		const channel =
			channel_ ??
			(source ? await readToolchainChannel(source) : undefined) ??
			"stable";
		const toolchainDir = self({ host, channel });

		const sdkArgs: Array<std.sdk.Arg> = [{ host: rustHost, target: rustHost }];
		if (std.triple.os(rustHost) === "linux") {
			sdkArgs.push({ toolchain: "gnu" });
		}
		const sandboxSdk = await tg.build(std.sdk, ...sdkArgs);

		proxySetup = await tg`export RUSTC="${toolchainDir}/bin/rustc"
export RUSTC_WRAPPER="${proxyDir}/bin/tgrustc"
export TGRUSTC_DRIVER_EXECUTABLE="${proxyBin}"
export TGRUSTC_RUN_MODE=1
export TGRUSTC_TANGRAM_RUSTC="${toolchainDir}/bin/rustc"
export TGRUSTC_SANDBOX_SDK="${sandboxSdk}"
export TGRUSTC_SOURCE_DIR="$PWD"
export TGRUSTC_CARGO="${toolchainDir}/bin/cargo"
export CARGO_HOST_RUNNER="${proxyDir}/bin/tgrustc runner"
# Snapshot host env names so the proxy can identify cargo:rustc-env additions.
export TGRUSTC_HOST_ENV_SNAPSHOT="$(mktemp)"
env | cut -d= -f1 > "$TGRUSTC_HOST_ENV_SNAPSHOT"`;
	}

	const featureFlags: Array<string> = [];
	if (disableDefaultFeatures) {
		featureFlags.push("--no-default-features");
	}
	if (features.length > 0) {
		featureFlags.push(`--features "${features.join(",")}"`);
	}

	// Nightly cargo for -Zhost-config support (stable silently ignores -Z).
	const os = std.triple.os(host);
	const hostLinker = os === "darwin" ? "clang" : "gcc";
	const cargoCmd = proxy
		? `"$TGRUSTC_CARGO" -Zhost-config -Ztarget-applies-to-host --config 'target-applies-to-host = false' --config 'host.linker = "${hostLinker}"' --config "host.runner = '$CARGO_HOST_RUNNER'"`
		: `cargo`;
	// --target is required for host.runner to apply to build scripts.
	const targetFlag = proxy ? `--target "$RUST_TARGET"` : "";
	const insertedFlags = [targetFlag, ...featureFlags].filter(Boolean).join(" ");
	// Symlink target/<triple>/<profile>/* into target/<profile>/ for plain-cargo compat.
	const execLine = insertedFlags
		? proxy
			? `${cargoCmd} "$1" ${insertedFlags} "\${@:2}"
__cargo_status=$?
for __f in "target/$RUST_TARGET/debug/"* "target/$RUST_TARGET/release/"*; do
  [ -f "$__f" ] && [ -x "$__f" ] || continue
  __name=$(basename "$__f")
  case "$__name" in *.*) continue;; esac
  __rel=$(echo "$__f" | sed "s|^target/|../|")
  __dir=$(dirname "$__f" | sed "s|^target/$RUST_TARGET/||")
  ln -sf "$__rel" "target/$__dir/$__name" 2>/dev/null || true
done
exit $__cargo_status`
			: `exec ${cargoCmd} "$1" ${insertedFlags} "\${@:2}"`
		: `exec ${cargoCmd} "$@"`;

	// Only "set" mutations; prefix/suffix would inherit `tg run` SDK PATH entries
	// and break passthrough compilation.
	let envSetup: tg.Template.Arg = "";
	if (depsEnv !== undefined) {
		const resolvedEnv = await std.env.arg(depsEnv);
		const lines: Array<tg.Template> = [];
		for (const [key, val] of Object.entries(resolvedEnv)) {
			if (val instanceof tg.Mutation && val.inner.kind === "set") {
				lines.push(await tg`export ${key}="${val.inner.value}"`);
			}
		}
		if (lines.length > 0) {
			envSetup = lines.reduce(
				(acc, line) => tg`${acc}
${line}`,
			);
		}
	}

	const preSetup = pre ? await tg`${pre}` : "";
	const exportsBlock = exports.join("\n");
	const script = tg`#!/usr/bin/env bash
set -euo pipefail
${exportsBlock}
${envSetup}
${vendorSetup}
${proxySetup}
${passthroughSetup}
${preSetup}
${execLine}
`;

	return tg.command({
		args: ["-c", script, "--"],
		executable: { path: "/bin/bash" },
	});
}

export async function build(...args: std.Args<Arg>): Promise<tg.Directory> {
	const resolved = await arg(...args);
	const depsEnv = await resolveDepsEnv(resolved);

	const {
		buildInTree = false,
		captureStderr = false,
		channel: channel_,
		checksum,
		disableCheckinCache = false,
		disableDefaultFeatures = false,
		env: env_,
		features = [],
		host,
		manifestSubdir,
		network = false,
		parallelJobs,
		pkgConfig = true,
		pre,
		processName,
		profile = "release",
		proxy = false,
		sdk: sdk_ = {},
		source,
		target: target_,
		timings = false,
		useCargoVendor = false,
		verbose = false,
	} = { ...resolved, env: depsEnv };
	const rustHost = rustTriple(host);
	const os = std.triple.os(rustHost);
	const target = target_ ? rustTriple(target_) : rustHost;

	const crossCompiling = target !== rustHost;

	// Forces GCC on Linux — rustc expects libgcc_s.
	const sdkArgs: Array<std.sdk.Arg> = [{ host: rustHost, target }, sdk_];
	if (
		os === "linux" &&
		sdkArgs.filter((arg) => arg?.toolchain === "llvm").length > 0
	) {
		sdkArgs.push({ toolchain: "gnu" });
	}

	const envs: std.Args<std.env.Arg> = [];

	const sdk = await tg.build(std.sdk, ...sdkArgs);
	envs.push(sdk);
	// Nightly required for host.runner.
	const channel = channel_ ?? (proxy ? "nightly" : "stable");
	const rustArtifact = await tg.build(self, {
		host: rustHost,
		target,
		channel,
	});
	envs.push(rustArtifact);
	if (pkgConfig) {
		envs.push(await tg.build(pkgconf, { host }));
	}

	// Extract only manifests so source changes don't re-vendor.
	let cargoConfig: tg.Template;
	if (useCargoVendor) {
		const manifests = await tg.build(extractCargoManifests, source);
		cargoConfig = await tg.build(vendoredSources, {
			manifestSubdir,
			source: manifests,
			useCargoVendor: true,
		});
	} else {
		const sourcePath = manifestSubdir
			? await source.get(manifestSubdir).then(tg.Directory.expect)
			: source;
		const cargoLock = await sourcePath.get("Cargo.lock").then(tg.File.expect);
		const vendoredDir = await tg.build(vendorDependencies, cargoLock);
		cargoConfig = await tg`
[source.crates-io]
replace-with = "vendored-sources"

[source.vendored-sources]
directory = "${vendoredDir}"`;
	}

	const proxyDir = proxy ? proxy_.proxy() : undefined;

	if (proxy && proxyDir !== undefined) {
		const hostLinker = os === "darwin" ? "clang" : "gcc";
		cargoConfig = await tg`${cargoConfig}

[host]
runner = ["${proxyDir}/bin/tgrustc", "runner"]
linker = "${hostLinker}"`;
	}

	// cargo config must be file-based, not env vars.
	const preparePathCommands = [
		tg`mkdir -p "${tg.output}/target"`,
		tg`export TARGET_DIR="$(realpath "${tg.output}/target")"`,
		tg`export CARGO_HOME="$(mktemp -d)"\necho '${cargoConfig}' > "$CARGO_HOME/config.toml"\ncd "$CARGO_HOME"`,
	];
	const preparePaths = tg.Template.join("\n", ...preparePathCommands);

	const prepareSource = buildInTree
		? tg`cp -R ${source}/. $PWD/work\nchmod -R u+w $PWD/work\nexport TGRUSTC_SOURCE_DIR="$PWD/work"`
		: tg`export TGRUSTC_SOURCE_DIR=$(realpath ${source})`;

	const manifestPathArg = manifestSubdir
		? `${manifestSubdir}/Cargo.toml`
		: `"Cargo.toml"`;
	const cargoArgs = [
		`--profile ${profile}`,
		tg`--target-dir "${tg.output}/target"`,
		`--manifest-path "$TGRUSTC_SOURCE_DIR/${manifestPathArg}"`,
		`--features "${features.join(",")}"`,
		"--target $RUST_TARGET",
	];
	if (!network) {
		cargoArgs.push("--offline", "--frozen");
	}
	if (disableDefaultFeatures) {
		cargoArgs.push("--no-default-features");
	}
	if (timings) {
		cargoArgs.push("--timings");
	}

	const cargoArgString = tg.Template.join(" ", ...cargoArgs);
	const cargoPrefix = proxy
		? "cargo -Zhost-config -Ztarget-applies-to-host"
		: "cargo";
	// Redirect + replay (not process substitution) to avoid tee being killed
	// before flushing on Linux.
	const buildCommand = captureStderr
		? tg`${cargoPrefix} build ${cargoArgString} 2>"${tg.output}/cargo-stderr.log"; cat "${tg.output}/cargo-stderr.log" >&2`
		: tg`${cargoPrefix} build ${cargoArgString}`;
	const buildScript = tg.Template.join(
		"\n",
		preparePaths,
		prepareSource,
		pre,
		buildCommand,
	);

	// Use the SDK's `gcc` to enable Tangram linking on non-cross builds.
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

	if (network) {
		const certFile = tg`${std.caCertificates()}/cacert.pem`;
		const networkEnv = {
			SSL_CERT_FILE: certFile,
			CARGO_HTTP_CAINFO: certFile,
		};
		envs.push(networkEnv);
	}

	if (crossCompiling) {
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

	if (proxy && proxyDir !== undefined) {
		const proxyBin = proxyDir
			.then((d) => d.get("bin/tgrustc"))
			.then(tg.File.expect);
		const proxyEnv: tg.Unresolved<std.env.Arg> = {
			RUSTC_WRAPPER: tg`${proxyDir}/bin/tgrustc`,
			// Avoids self-checkin per invocation.
			TGRUSTC_DRIVER_EXECUTABLE: proxyBin,
		};
		if (disableCheckinCache) {
			proxyEnv.TGRUSTC_DISABLE_CHECKIN_CACHE = "1";
		}
		envs.push(proxyEnv);
	}

	{
		const effectiveJobs = parallelJobs ?? (proxy ? 256 : undefined);
		if (effectiveJobs !== undefined) {
			const jobsEnv = {
				CARGO_BUILD_JOBS: `${effectiveJobs}`,
			};
			envs.push(jobsEnv);
		}
	}

	if (verbose) {
		const verbosityEnv = {
			RUSTFLAGS: tg.Mutation.suffix("-v", " "),
			CARGO_TERM_VERBOSE: "true",
		};
		envs.push(verbosityEnv);
	}

	const env = std.env.arg(...envs, env_);

	let builder = std.build`${buildScript}`
		.checksum(checksum)
		.network(network)
		.env(env);
	if (processName !== undefined) {
		builder = builder.named(processName);
	}
	const artifact = await builder.then(tg.Directory.expect);

	// Cargo maps "dev" → "debug"; other profiles use their name.
	const profileDir = profile === "dev" ? "debug" : profile;
	const releaseDir = await artifact
		.get(`target/${target}/${profileDir}`)
		.then(tg.Directory.expect);

	const bins: Record<string, tg.Artifact> = {};
	for await (const [name, artifact] of releaseDir) {
		const resolved =
			artifact instanceof tg.Symlink ? await artifact.resolve() : artifact;
		if (resolved instanceof tg.File && (await resolved.executable)) {
			bins[name] = resolved;
		}
	}

	let binDir = await tg.directory({});
	for (const [name, artifact] of Object.entries(bins)) {
		binDir = await tg.directory(binDir, {
			[name]: artifact,
		});
	}

	const result: Record<string, tg.Artifact> = { bin: binDir };
	if (captureStderr) {
		const stderrLog = await artifact
			.tryGet("cargo-stderr.log")
			.then((a) => (a instanceof tg.File ? a : undefined));
		if (stderrLog) {
			result["cargo-stderr.log"] = stderrLog;
		}
	}

	if (timings) {
		const timingsDir = await artifact
			.tryGet("target/cargo-timings")
			.then((a) => (a instanceof tg.Directory ? a : undefined));
		if (timingsDir) {
			result["cargo-timings"] = timingsDir;
		}
	}

	return tg.directory(result);
}

export type VendoredSourcesArg = {
	rustTarget?: string;
	manifestSubdir?: string | undefined;
	source: tg.Directory;
	useCargoVendor?: boolean;
};

export const vendoredSources = async (
	arg: VendoredSourcesArg,
): Promise<tg.Template> => {
	const { rustTarget, manifestSubdir, source, useCargoVendor = false } = arg;
	if (useCargoVendor) {
		const cargoVendorArg: CargoVendorArg = { source };
		if (rustTarget !== undefined) {
			cargoVendorArg.rustTarget = rustTarget;
		}
		if (manifestSubdir !== undefined) {
			cargoVendorArg.manifestSubdir = manifestSubdir;
		}
		const vendorResult = await tg.build(cargoVendor, cargoVendorArg);
		const vendoredSources = await vendorResult
			.get("tg_vendor_dir")
			.then(tg.Directory.expect);
		const config = await vendorResult.get("config").then(tg.File.expect);

		const text = await config.text;
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
		const vendoredSources = await tg.build(vendorDependencies, cargoLock);
		return tg`
[source.crates-io]
replace-with = "vendored-sources"

[source.vendored-sources]
directory = "${vendoredSources}"`;
	}
};

export type CargoVendorArg = {
	rustTarget?: string;
	manifestSubdir?: string | undefined;
	source: tg.Directory;
};

/** Extract only Cargo manifest files (Cargo.toml and Cargo.lock) from a source directory. */
export const extractCargoManifests = async (
	source: tg.Directory,
): Promise<tg.Directory> => {
	// Satisfies cargo's target validation.
	const placeholderFile = tg.file(
		"// Placeholder for cargo manifest validation\n",
	);

	const extractManifests = async (
		dir: tg.Directory,
		path: string,
	): Promise<tg.Directory> => {
		let result = await tg.directory();
		let hasCargoToml = false;

		for await (const [name, artifact] of dir) {
			const fullPath = path ? `${path}/${name}` : name;
			if (artifact instanceof tg.Directory) {
				// node_modules never contains Cargo manifests and can be huge.
				if (name === "node_modules") continue;
				const subManifests = await extractManifests(artifact, fullPath);
				const entries = await subManifests.entries;
				if (Object.keys(entries).length > 0) {
					result = await tg.directory(result, { [name]: subManifests });
				}
			} else if (
				artifact instanceof tg.File &&
				(name === "Cargo.toml" || name === "Cargo.lock")
			) {
				result = await tg.directory(result, { [name]: artifact });
				if (name === "Cargo.toml") {
					hasCargoToml = true;
				}
			}
		}

		if (hasCargoToml) {
			result = await tg.directory(result, {
				src: {
					"lib.rs": placeholderFile,
					"main.rs": placeholderFile,
				},
			});
		}

		return result;
	};

	return extractManifests(source, "");
};

/** Run `cargo vendor` to download dependencies. */
export const cargoVendor = async (
	unresolvedArg: tg.Unresolved<CargoVendorArg>,
): Promise<tg.Directory> => {
	const arg = await tg.resolve(unresolvedArg);
	const { rustTarget: rustTarget_, manifestSubdir, source } = arg;
	const rustTarget = rustTarget_ ?? std.triple.host();

	const certFile = tg`${std.caCertificates()}/cacert.pem`;
	const manifestPathArg = manifestSubdir
		? `${manifestSubdir}/Cargo.toml`
		: `"Cargo.toml"`;
	const vendorScript = tg`
		set -x
		export HOME=$PWD
		TGRUSTC_SOURCE_DIR="$(realpath ${source})"
		export CARGO_HOME=$PWD
		mkdir -p "${tg.output}/tg_vendor_dir"
		cd "${tg.output}"
		cargo vendor --versioned-dirs --locked --manifest-path $TGRUSTC_SOURCE_DIR/${manifestPathArg} tg_vendor_dir > "${tg.output}/config"
	`;
	const rustArtifact = self();
	const sdk = std.sdk();
	return std.build`${vendorScript}`
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
};

/** Implementation of `cargo vendor` in tg typescript. */
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
		await cargoLock.text,
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

/** Strip extraneous files from a downloaded crate and generate .cargo-checksum.json. */
export const vendorPackage = async (
	pkg: tg.Directory,
	checksum: tg.Checksum,
): Promise<tg.Directory> => {
	type CargoChecksum = {
		files: Record<string, string>;
		package: string;
	};

	pkg = await tg.directory(pkg, {
		[".cargo_vcs_info.json"]: undefined,
		[".gitignore"]: undefined,
		["Cargo.toml.orig"]: undefined,
	});

	const cargoChecksum: CargoChecksum = {
		files: {},
		package: checksum.replace("sha256:", ""),
	};

	const stack: Array<[string, tg.Directory]> = [["", pkg]];
	while (!(stack.length == 0)) {
		const [path, dir] = stack.pop() as [string, tg.Directory];
		for (let [subpath, artifact] of Object.entries(await dir.entries)) {
			subpath = `${path}${subpath}`;
			if (artifact instanceof tg.Directory) {
				stack.push([`${subpath}/`, artifact]);
			} else if (artifact instanceof tg.File) {
				const bytes = await artifact.bytes;
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

/** Read the toolchain channel from rust-toolchain.toml if present in a source directory. */
const readToolchainChannel = async (
	dir: tg.Directory,
): Promise<string | undefined> => {
	const file = await dir
		.tryGet("rust-toolchain.toml")
		.then((a) => (a instanceof tg.File ? a : undefined));
	if (!file) return undefined;
	const text = await file.text;
	const toml = tg.encoding.toml.decode(text) as {
		toolchain?: { channel?: string };
	};
	return toml.toolchain?.channel;
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
		${helloWorkspace}/bin/cli >> ${tg.output}
	`.then(tg.File.expect);
	const helloText = await helloOutput.text;
	tg.assert(helloText.trim() === "Hello from a workspace!");

	const helloOpenssl = build({
		source: tests.get("hello-openssl").then(tg.Directory.expect),
		env: std.env.arg(openssl(), pkgconf(), {
			TGLD_TRACING: "tgld=trace",
		}),
		proxy: false,
	});

	const openSslOutput = await $`
		${helloOpenssl}/bin/hello-openssl >> ${tg.output}
	`.then(tg.File.expect);
	const openSslText = await openSslOutput.text;
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
