/** This package takes a bootstrap C/C++ compiler and some utilities and canadian-crosses up a sizzling plate of farm-fresh GCC. The output of this package can then be used to build other compilers like LLVM. */

import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.ts";
import binutils from "./binutils.tg.ts";
import * as dependencies from "../dependencies.tg.ts";
import * as gcc from "./gcc.tg.ts";
import kernelHeaders from "../kernel_headers.tg.ts";
import { constructSysroot } from "../libc.tg.ts";
import * as proxy from "../proxy.tg.ts";

export type ToolchainArg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	target?: string;
};

/** Construct a complete binutils + libc + gcc toolchain. */
export const toolchain = async (arg: ToolchainArg) => {
	const { host: host_, target: target_ } = arg;
	const host = std.sdk.canonicalTriple(host_ ?? std.triple.host());
	const target = std.sdk.canonicalTriple(target_ ?? host);

	if (std.triple.os(host) === "darwin") {
		throw new Error("gcc builds are not supported on Darwin hosts");
	}

	// Always build a native toolchain.
	const nativeToolchain = await canadianCross({ host });

	// If only the native toolchain was requested, return it.
	if (host === target) {
		return nativeToolchain;
	}

	// If a cross-target was requested, build the components required using the native toolchain.
	const nativeProxyEnv = await proxy.env({
		toolchain: nativeToolchain,
		build: host,
		host,
	});
	const proxiedNativeToolchain = await std.env.arg(
		nativeToolchain,
		nativeProxyEnv,
		{
			CC: tg.Mutation.setIfUnset<tg.Template.Arg>("gcc"),
			CXX: tg.Mutation.setIfUnset<tg.Template.Arg>("g++"),
		},
		{ utils: false },
	);

	// Create a new set of build tools against the new native toolchain.
	const nativeUtils = await tg
		.build(std.utils.env, {
			env: proxiedNativeToolchain,
		})
		.named("native utils");
	const nativeBuildTools = await tg
		.build(dependencies.buildTools, {
			host,
			buildToolchain: std.env.arg(proxiedNativeToolchain, nativeUtils),
			preset: "toolchain",
		})
		.named("native build tools");
	const nativeBuildEnv = std.env.arg(nativeUtils, nativeBuildTools);

	const { crossGcc } = await crossToolchain({
		build: host, // We've produced a native toolchain, so we can use it to build the cross-toolchain.
		buildToolchain: proxiedNativeToolchain,
		env: nativeBuildEnv,
		host,
		target,
		variant: "stage2_full",
	});

	return crossGcc;
};

type CanadianCrossArg = {
	host?: string;
	env?: std.env.EnvObject;
};

export const canadianCross = async (arg?: CanadianCrossArg) => {
	const { host: host_, env: env_ } = arg ?? {};
	const host = std.sdk.canonicalTriple(host_ ?? std.triple.host());

	const target = host;
	const build = bootstrap.toolchainTriple(host);
	const bootstrapToolchain = bootstrap.sdk(host);

	// Set up build environment tools.
	const bootstrapUtils = await tg
		.build(std.utils.env, {
			env: bootstrapToolchain,
		})
		.named("bootstrap utils");
	const bootstrapBuildTools = await tg
		.build(dependencies.buildTools, {
			host: build,
			buildToolchain: std.env.arg(bootstrapToolchain, bootstrapUtils),
			preset: "toolchain",
		})
		.named("bootstrap build tools");
	const bootstrapBuildEnv = std.env.arg(
		bootstrapUtils,
		bootstrapBuildTools,
		env_,
	);

	// Create cross-toolchain from build to host.
	const { crossGcc: buildToHostCross, sysroot } =
		await buildToHostCrossToolchain({
			host,
			env: bootstrapBuildEnv,
		});

	// Proxy the cross toolchain.
	const crossProxyEnv = await proxy.env({
		toolchain: buildToHostCross,
		build,
		host,
	});

	const stage1HostSdk = std.env.arg(
		buildToHostCross,
		crossProxyEnv,
		bootstrapUtils,
		bootstrapBuildTools,
		env_,
	);

	// Create a native toolchain (host to host).
	const nativeBinutils = await binutils({
		fortifySource: false,
		bootstrap: true,
		env: stage1HostSdk,
		build: host,
		host,
		target,
	});

	// Build a fully native GCC toolchain.
	const nativeGcc = tg
		.build(gcc.build, {
			bootstrap: true,
			build: host,
			bundledSources: true, // Build gmp/isl/mpfr/mpc inline
			crossNative: true, // Include workaround for configuring target libraries with an unproxied compiler.
			env: std.env.arg(stage1HostSdk),
			host,
			sysroot,
			target,
			targetBinutils: nativeBinutils,
			variant: "stage2_full",
		})
		.named("native gcc");

	return nativeGcc;
};

export const buildToHostCrossToolchain = async (
	arg?: tg.Unresolved<CanadianCrossArg>,
) => {
	const { host: host_, env } = (await tg.resolve(arg)) ?? {};
	const host = std.sdk.canonicalTriple(host_ ?? std.triple.host());
	const build = bootstrap.toolchainTriple(host);
	const buildToolchain = bootstrap.sdk(build);

	// Create cross-toolchain from build to host.
	return crossToolchain({
		build,
		buildToolchain,
		env,
		host: build,
		target: host,
		variant: "stage1_limited",
	});
};

export type CrossToolchainArg = {
	build?: string;
	/** The compiler for the build triple. Separated from the other env to allow dropping this compiler partway through the build. */
	buildToolchain?: std.env.Arg;
	/** Additional utilities. */
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
	target: string;
	variant?: gcc.Variant;
};

export const crossToolchain = async (arg: tg.Unresolved<CrossToolchainArg>) => {
	const {
		buildToolchain,
		build: build_,
		env: env_,
		host: host_,
		sdk,
		target: target_,
		variant = "stage2_full",
	} = await tg.resolve(arg);

	const host = host_ ?? std.triple.host();
	const buildTriple = build_ ?? host;
	const target = target_ ?? host;

	// Produce the binutils for building the cross-toolchain.
	const hostLibraries = await tg
		.build(dependencies.hostLibraries, {
			host,
			buildToolchain: std.env.arg(buildToolchain, env_, { utils: false }),
		})
		.named("host libraries");
	const buildEnv = std.env.arg(env_, buildToolchain, hostLibraries, {
		utils: false,
	});

	const targetBinutils = binutils({
		bootstrap: true,
		build: buildTriple,
		env: buildEnv,
		host,
		target,
	});

	const binutilsEnv = std.env.arg(env_, targetBinutils, hostLibraries, {
		utils: false,
	});

	const sysroot = await buildSysroot({
		build: buildTriple,
		buildToolchain,
		env: binutilsEnv,
		host: target,
		sdk,
		targetBinutils,
	});

	// Produce a toolchain containing the sysroot and a cross-compiler.
	const crossGcc = await tg
		.build(gcc.build, {
			bootstrap: true,
			build: buildTriple,
			env: buildEnv,
			host,
			sdk,
			sysroot,
			target,
			targetBinutils,
			variant,
		})
		.named("cross gcc");

	return {
		crossGcc,
		sysroot,
	};
};

export type BuildSysrootArg = {
	build?: string;
	// This is kept separate from the remaining env to avoid passing it in to the libc build.
	buildToolchain?: std.env.Arg;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	targetBinutils?: tg.Directory;
};

export const buildSysroot = async (arg: tg.Unresolved<BuildSysrootArg>) => {
	const {
		build: build_,
		buildToolchain,
		targetBinutils: targetBinutils_,
		env,
		host: host_,
		sdk,
	} = arg ? await tg.resolve(arg) : {};

	const host = host_ ?? std.triple.host();
	const buildTriple = build_ ?? host;
	const target = host;

	const buildEnv = std.env.arg(env, buildToolchain, { utils: false });
	const targetBinutils =
		targetBinutils_ ??
		(await binutils({
			bootstrap: true,
			build: buildTriple,
			env: buildEnv,
			host,
			sdk,
			target,
		}));

	// Produce the linux headers.
	const linuxHeaders = await tg.directory({
		include: await kernelHeaders({
			bootstrap: true,
			build: buildTriple,
			env: buildEnv,
			host: target,
			sdk,
		}),
	});

	// THe initial GCC needs a sysroot containing the Linux headers only.
	const sysroot = await tg.directory({
		[target]: linuxHeaders,
	});

	// Produce the initial gcc required to build the standard C library.
	const initialGccDir = await tg
		.build(gcc.build, {
			bootstrap: true,
			build: buildTriple,
			env: buildEnv,
			host: buildTriple,
			sdk,
			sysroot,
			target,
			targetBinutils,
			variant: "stage1_bootstrap",
		})
		.named("initial gcc");

	// Produce a combined directory containing the correct C library for the host and the Linux headers.
	return constructSysroot({
		bootstrap: true,
		build: buildTriple,
		host,
		linuxHeaders,
		env: std.env.arg(env, initialGccDir, { utils: false }),
		sdk,
	});
};

export const extractSysroot = async (hostArg?: string) => {
	const host = hostArg ?? std.triple.host();
	const fullToolchain = await canadianCross({ host });
	const include = fullToolchain.get("include").then(tg.Directory.expect);
	const lib = fullToolchain.get("lib").then(tg.Directory.expect);
	const filtered = await tg.directory({ include, lib });
	return filtered;
};

export const extractSysrootGlibc = async () => {
	const detectedHost = std.triple.host();
	const triple = std.triple.normalize(
		std.triple.create(detectedHost, { environment: "gnu" }),
	);
	return await extractSysroot(triple);
};

export const extractSysrootMusl = async () => {
	const detectedHost = std.triple.host();
	const triple = std.triple.normalize(
		std.triple.create(detectedHost, { environment: "musl" }),
	);
	return await extractSysroot(triple);
};

export const testCanadianCross = async () => {
	const toolchainDir = await canadianCross();
	return toolchainDir;
};

export const testCross = async () => {
	const host = std.triple.host();
	const hostArch = std.triple.arch(host);
	const targetArch = hostArch === "x86_64" ? "aarch64" : "x86_64";
	const target = std.triple.create(host, { arch: targetArch });
	const dir = await toolchain({ host, target });
	return dir;
};

export const testCrossMips = async () => {
	const host = std.triple.host();
	const target = "mips-unknown-linux-gnu";
	const dir = await toolchain({ host, target });
	return dir;
};

export const testCrossRpi = async () => {
	const host = std.triple.host();
	const target = "armv7l-linux-gnueabihf";
	const dir = await toolchain({ host, target });
	return dir;
};
