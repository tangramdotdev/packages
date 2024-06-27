/** This package takes a bootstrap C/C++ compiler and some utilities and canadian-crosses up a sizzling plate of farm-fresh GCC. The output of this package can then be used to build other compilers like LLVM. */

import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.tg.ts";
import binutils from "../binutils.tg.ts";
import * as dependencies from "../dependencies.tg.ts";
import * as gcc from "../gcc.tg.ts";
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
export let toolchain = tg.target(async (arg: ToolchainArg) => {
	let { host: host_, target: target_ } = arg;
	let host = std.sdk.canonicalTriple(host_ ?? (await std.triple.host()));
	let target = std.sdk.canonicalTriple(target_ ?? host);

	if (std.triple.os(host) === "darwin") {
		return darwinCrossToolchain({ host, target });
	}

	// Set up build environment tools.
	let buildTools = await buildToolsForHost(host);

	// Always build a native toolchain.
	let nativeToolchain = await canadianCross({ host, env: buildTools });

	// If only the native toolchain was requested, return it.
	if (host === target) {
		return nativeToolchain;
	}

	// If a cross-target was requested, build the components required using the native toolchain.
	let nativeProxyEnv = await proxy.env({
		toolchain: nativeToolchain,
		build: host,
		host,
	});

	let { env } = await crossToolchain({
		build: host, // We've produced a native toolchain, so we can use it to build the cross-toolchain.
		env: std.env.arg(nativeToolchain, nativeProxyEnv, buildTools),
		host,
		sdk: false,
		target,
		variant: "stage2_full",
	});

	return env;
});

export let buildToolsForHost = async (hostArg: string) => {
	let sdk = bootstrap.sdk(hostArg);
	let host = await bootstrap.toolchainTriple(hostArg);
	let utils = std.utils.env({ host, sdk: false, env: sdk });
	// This env is used to build the remaining dependencies only. It includes the bootstrap SDK.
	let utilsEnv = std.env.arg(utils, sdk);
	let additionalToolsArg = { host, sdk: false, env: utilsEnv };
	let additionalTools = [
		dependencies.m4.build(additionalToolsArg),
		dependencies.bison.build(additionalToolsArg),
		dependencies.perl.build(additionalToolsArg),
		dependencies.python.build(additionalToolsArg),
		dependencies.zstd.build(additionalToolsArg),
	];
	// This env contains the standard utils and additional tools, but NO SDK, so each build step can swap the compiler out accordingly.
	return await std.env.arg(utils, ...additionalTools);
};

export type CrossToolchainArg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
	sysroot?: tg.Directory;
	target: string;
	variant?: gcc.Variant;
};

export let crossToolchain = tg.target(async (arg: CrossToolchainArg) => {
	let {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		sysroot: sysroot_,
		target: target_,
		variant = "stage2_full",
	} = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let buildTriple = build_ ?? host;
	let target = target_ ?? host;

	// Produce the binutils for build and host.
	let [buildBinutils, crossBinutils] = await Promise.all([
		binutils({
			build: buildTriple,
			env: env_,
			host: buildTriple,
			sdk,
			target: buildTriple,
		}),
		binutils({
			build: buildTriple,
			env: env_,
			host,
			sdk,
			target,
		}),
	]);

	let sysroot =
		sysroot_ ??
		(await buildSysroot({
			build: buildTriple,
			env: await std.env.arg(env_, buildBinutils, crossBinutils),
			host: target,
			sdk,
		}));

	// Produce a toolchain containing the sysroot and a cross-compiler.
	let crossGCC = await gcc.build({
		build: buildTriple,
		env: std.env.arg(env_, buildBinutils, crossBinutils),
		host,
		sdk,
		sysroot,
		target,
		variant,
	});

	let combined = await tg.directory(crossGCC, sysroot);

	return {
		env: await std.env.arg(combined, buildBinutils, crossBinutils),
		sysroot,
	};
});

export type BuildSysrootArg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg | boolean;
};

export let buildSysroot = tg.target(async (arg: BuildSysrootArg) => {
	let { build: build_, env, host: host_, sdk } = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let buildTriple = build_ ?? host;
	let target = host;

	// Produce the linux headers.
	let linuxHeaders = await tg.directory({
		include: await kernelHeaders({
			build: buildTriple,
			env,
			host: target,
		}),
	});

	let linuxHeadersSysroot = await tg.directory({
		[target]: linuxHeaders,
	});

	// Produce the initial gcc required to build the standard C library.
	let bootstrapGCC = await gcc.build({
		build: buildTriple,
		env,
		host: buildTriple,
		sdk,
		sysroot: linuxHeadersSysroot,
		target,
		variant: "stage1_bootstrap",
	});

	// Produce a combined directory containing the correct C library for the host and the Linux headers.
	let sysroot = await constructSysroot({
		build: buildTriple,
		host,
		linuxHeaders,
		env: await std.env.arg(env, bootstrapGCC),
		sdk: false,
	});
	return sysroot;
});

type CanadianCrossArg = {
	host?: string;
	env?: std.env.Arg;
};

export let canadianCross = tg.target(async (arg?: CanadianCrossArg) => {
	let { host: host_, env: env_ } = arg ?? {};
	let host = std.sdk.canonicalTriple(host_ ?? (await std.triple.host()));

	let target = host;
	let build = await bootstrap.toolchainTriple(host);

	let sdk = bootstrap.sdk(host);

	// Create cross-toolchain from build to host.
	let { env: buildToHostCross, sysroot } = await buildToHostCrossToolchain({
		host,
		env: await std.env.arg(sdk, env_),
	});
	let combinedUnproxiedEnv = std.env.arg(sdk, buildToHostCross, env_);

	// Proxy the cross toolchain and produce a combined environment.
	let crossProxyEnv = await proxy.env({
		toolchain: buildToHostCross,
		build,
		host,
	});
	let combinedProxiedEnv = std.env.arg(combinedUnproxiedEnv, crossProxyEnv);

	// Create a native toolchain (host to host).
	let nativeHostBinutils = await binutils({
		env: combinedProxiedEnv,
		sdk: false,
		build,
		host,
		target,
	});

	// Build a fully native GCC toolchain.
	let fullGCC = await gcc.build({
		build,
		env: std.env.arg(combinedUnproxiedEnv, nativeHostBinutils),
		host,
		sysroot,
		sdk: false,
		target,
		variant: "stage2_full",
	});

	// Flatten the sysroot and combine into a native toolchain.
	let innerSysroot = sysroot.get(target).then(tg.Directory.expect);
	let combined = tg.directory(fullGCC, innerSysroot);

	return std.env.arg(combined, nativeHostBinutils);
});

export let buildToHostCrossToolchain = async (arg?: CanadianCrossArg) => {
	let { host: host_, env } = arg ?? {};
	let host = std.sdk.canonicalTriple(host_ ?? (await std.triple.host()));
	let build = await bootstrap.toolchainTriple(host);

	// Create cross-toolchain from build to host.
	return crossToolchain({
		build,
		env,
		sdk: false,
		host: build,
		target: host,
		variant: "stage1_limited",
	});
};

type DarwinCrossToolchainArg = {
	host: string;
	target: string;
};

let darwinCrossToolchain = async (arg: DarwinCrossToolchainArg) => {
	let { host, target } = arg;
	tg.assert(std.triple.os(host) === "darwin");

	let tag = "v13.20.0-1";
	let baseUrl = `https://github.com/deciduously/homebrew-macos-cross-toolchains/releases/download/${tag}`;

	let checksums: { [key: string]: tg.Checksum } = {
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

	let hostArchAndOs = std.triple.archAndOs(host);
	let canonicalTarget = std.sdk.canonicalTriple(target);
	let toolchainDescription = `${canonicalTarget}-${hostArchAndOs}`;
	let checksum = checksums[toolchainDescription];
	tg.assert(checksum, `unsupported toolchain ${toolchainDescription}`);

	let url = `${baseUrl}/${toolchainDescription}.tar.gz`;

	return await std
		.download({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export let testCanadianCross = async () => {
	let toolchainDir = await canadianCross();
	return toolchainDir;
};

export let testCross = async () => {
	let host = await std.triple.host();
	let hostArch = std.triple.arch(host);
	let targetArch = hostArch === "x86_64" ? "aarch64" : "x86_64";
	let target = std.triple.create(host, { arch: targetArch });
	let dir = await toolchain({ host, target });
	return dir;
};

export let testCrossRpi = async () => {
	let host = await std.triple.host();
	let target = "armv7l-linux-gnueabihf";
	let dir = await toolchain({ host, target });
	return dir;
};
