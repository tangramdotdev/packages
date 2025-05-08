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
	sdk?: std.sdk.Arg | boolean;
	target?: string;
};

/** Construct a complete binutils + libc + gcc toolchain. */
export const toolchain = async (arg: ToolchainArg) => {
	const { host: host_, target: target_ } = arg;
	const host = std.sdk.canonicalTriple(host_ ?? (await std.triple.host()));
	const target = std.sdk.canonicalTriple(target_ ?? host);

	if (std.triple.os(host) === "darwin") {
		return darwinCrossToolchain({ host, target });
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
			CC: tg.Mutation.setIfUnset("gcc"),
			CXX: tg.Mutation.setIfUnset("g++"),
		},
	);

	// Create a new set of build tools against the new native toolchain.
	const nativeBuildTools = await dependencies.buildTools({
		host,
		buildToolchain: proxiedNativeToolchain,
		level: "python",
	});

	const { crossGcc } = await crossToolchain({
		build: host, // We've produced a native toolchain, so we can use it to build the cross-toolchain.
		buildToolchain: proxiedNativeToolchain,
		env: nativeBuildTools,
		host,
		sdk: false,
		target,
		variant: "stage2_full",
	});

	return crossGcc;
};

type CanadianCrossArg = {
	host?: string;
	env?: std.env.Arg;
};

export const canadianCross = async (arg?: CanadianCrossArg) => {
	const { host: host_, env: env_ } = arg ?? {};
	const host = std.sdk.canonicalTriple(host_ ?? (await std.triple.host()));

	const target = host;
	const build = await bootstrap.toolchainTriple(host);
	const bootstrapToolchain = bootstrap.sdk(host);

	// Set up build environment tools.
	const bootstrapBuildTools = await dependencies.buildTools({
		host: build,
		buildToolchain: bootstrapToolchain,
		level: "python",
	});

	// Create cross-toolchain from build to host.
	const { crossGcc: buildToHostCross, sysroot } =
		await buildToHostCrossToolchain({
			host,
			env: std.env.arg(bootstrapBuildTools, env_),
		});

	// Proxy the cross toolchain.
	const crossProxyEnv = await proxy.env({
		toolchain: buildToHostCross,
		build,
		forcePrefix: true,
		host,
	});

	const stage1HostSdk = std.env.arg(
		buildToHostCross,
		crossProxyEnv,
		bootstrapBuildTools,
		env_,
	);

	// Create a native toolchain (host to host).
	const nativeBinutils = await binutils({
		autotools: { fortifySource: false },
		env: stage1HostSdk,
		sdk: false,
		build: host,
		host,
		target,
	});

	// Build a fully native GCC toolchain.
	const nativeGcc = gcc.build({
		build: host,
		bundledSources: true, // Build gmp/isl/mpfr/mpc inline
		crossNative: true, // Include workaround for configuring target libraries with an unproxied compiler.
		env: stage1HostSdk,
		host,
		sdk: false,
		sysroot,
		target,
		targetBinutils: nativeBinutils,
		variant: "stage2_full",
	});

	return nativeGcc;
};

export const buildToHostCrossToolchain = async (
	arg?: tg.Unresolved<CanadianCrossArg>,
) => {
	const { host: host_, env } = (await tg.resolve(arg)) ?? {};
	const host = std.sdk.canonicalTriple(host_ ?? (await std.triple.host()));
	const build = await bootstrap.toolchainTriple(host);
	const buildToolchain = bootstrap.sdk(build);

	// Create cross-toolchain from build to host.
	return crossToolchain({
		build,
		buildToolchain,
		env,
		sdk: false,
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
	sdk?: std.sdk.Arg | boolean;
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

	const host = host_ ?? (await std.triple.host());
	const buildTriple = build_ ?? host;
	const target = target_ ?? host;

	// Produce the binutils for building the cross-toolchain.
	const hostLibraries = dependencies.hostLibraries({
		host,
		buildToolchain: std.env.arg(buildToolchain, env_),
	});
	const buildEnv = std.env.arg(env_, buildToolchain, hostLibraries);

	const targetBinutils = binutils({
		build: buildTriple,
		env: buildEnv,
		host,
		sdk,
		target,
	});

	const binutilsEnv = std.env.arg(env_, targetBinutils, hostLibraries);

	const sysroot = await buildSysroot({
		build: buildTriple,
		buildToolchain,
		env: binutilsEnv,
		host: target,
		sdk,
		targetBinutils,
	});

	// Produce a toolchain containing the sysroot and a cross-compiler.
	const crossGcc = await gcc.build({
		build: buildTriple,
		env: buildEnv,
		host,
		sdk,
		sysroot,
		target,
		targetBinutils,
		variant,
	});

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
	sdk?: std.sdk.Arg | boolean;
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

	const host = host_ ?? (await std.triple.host());
	const buildTriple = build_ ?? host;
	const target = host;

	const buildEnv = std.env.arg(env, buildToolchain);
	const targetBinutils =
		targetBinutils_ ??
		(await binutils({ build: buildTriple, env: buildEnv, host, sdk, target }));

	// Produce the linux headers.
	const linuxHeaders = await tg.directory({
		include: await kernelHeaders({
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
	const initialGccDir = await gcc.build({
		build: buildTriple,
		env: buildEnv,
		host: buildTriple,
		sdk,
		sysroot,
		target,
		targetBinutils,
		variant: "stage1_bootstrap",
	});

	// Produce a combined directory containing the correct C library for the host and the Linux headers.
	return constructSysroot({
		build: buildTriple,
		host,
		linuxHeaders,
		env: std.env.arg(env, initialGccDir),
		sdk: false,
	});
};

type DarwinCrossToolchainArg = {
	host: string;
	target: string;
};

const darwinCrossToolchain = async (arg: DarwinCrossToolchainArg) => {
	const { host, target } = arg;
	tg.assert(std.triple.os(host) === "darwin");

	const tag = "v13.20.0-1";
	const baseUrl = `https://github.com/deciduously/homebrew-macos-cross-toolchains/releases/download/${tag}`;

	const checksums: { [key: string]: tg.Checksum } = {
		["aarch64-unknown-linux-gnu-aarch64-darwin"]:
			"sha256:d87efab534ca68814d7081fd001fbc2808a6dba09dbeefec38558203d521acae",
		["aarch64-unknown-linux-gnu-x86_64-darwin"]:
			"sha256:03aede7b899bdcab7cd3c3b1b2e92bf21723eba35478feb5f6a241980498616f",
		["aarch64-unknown-linux-musl-x86_64-darwin"]:
			"sha256:902313390fb624c2301f92143968cf43abfc048f8c748aede0f9b33cab5be26b",
		["aarch64-unknown-linux-musl-aarch64-darwin"]:
			"sha256:e293004542f6e6622d638192fd99f572e21ad896e2e567f135b8c533c5d78bf6",
		["x86_64-unknown-linux-gnu-aarch64-darwin"]:
			"sha256:78be08eee3c3fba42f1cc99fbd0a39c9c79a415ad24d39cf8eb8fc0627b45c4a",
		["x86_64-unknown-linux-gnu-x86_64-darwin"]:
			"sha256:04e141d9968c6cf778442417cfd5769b080567692c14a856eaf90b7ab6aff018",
		["x86_64-unknown-linux-musl-x86_64-darwin"]:
			"sha256:1194f4539cf4f48a321842264b04eaf4fbf68c7133d8cc6ff3f5a40e3a8b6f8b",
		["x86_64-unknown-linux-musl-aarch64-darwin"]:
			"sha256:2ef10ee4c40aa1a536def1fc5eecec73bcd63d72ff86db258b297c0e477e48cc",
	};

	const hostArchAndOs = std.triple.archAndOs(host);
	const canonicalTarget = std.sdk.canonicalTriple(target);
	const toolchainDescription = `${canonicalTarget}-${hostArchAndOs}`;
	const checksum = checksums[toolchainDescription];
	tg.assert(checksum, `unsupported toolchain ${toolchainDescription}`);

	const url = `${baseUrl}/${toolchainDescription}.tar.gz`;

	return await std.download
		.extractArchive({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export const testCanadianCross = async () => {
	const toolchainDir = await canadianCross();
	return toolchainDir;
};

export const testCross = async () => {
	const host = await std.triple.host();
	const hostArch = std.triple.arch(host);
	const targetArch = hostArch === "x86_64" ? "aarch64" : "x86_64";
	const target = std.triple.create(host, { arch: targetArch });
	const dir = await toolchain({ host, target });
	return dir;
};

export const testCrossMips = async () => {
	const host = await std.triple.host();
	const target = "mips-unknown-linux-gnu";
	const dir = await toolchain({ host, target });
	return dir;
};

export const testCrossRpi = async () => {
	const host = await std.triple.host();
	const target = "armv7l-linux-gnueabihf";
	const dir = await toolchain({ host, target });
	return dir;
};
