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
		buildToolchain: nativeToolchain,
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

export let buildToolsForHost = (host: string) => {
	let sdk = bootstrap.sdk(host);
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
	return std.env.arg(utils, ...additionalTools);
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
	let build = bootstrap.toolchainTriple(host);

	let sdk = bootstrap.sdk(host);

	// Create cross-toolchain from build to host.
	let { env: buildToHostCross, sysroot } = await buildToHostCrossToolchain({
		host,
		env: await std.env.arg(sdk, env_),
	});

	// Create a native toolchain (host to host).
	let nativeHostBinutils = await binutils({
		env: std.env.arg(sdk, buildToHostCross, env_),
		sdk: false,
		build,
		host,
		staticBuild: true,
		target,
	});

	let fullGCC = await gcc.build({
		build,
		env: std.env.arg(sdk, buildToHostCross, env_, nativeHostBinutils),
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
	let build = bootstrap.toolchainTriple(host);

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

	let tag = "v13.2.0";
	let baseUrl = `https://github.com/messense/homebrew-macos-cross-toolchains/releases/download/${tag}`;

	let checksums: { [key: string]: tg.Checksum } = {
		["aarch64-unknown-linux-gnu-aarch64-darwin"]:
			"sha256:a87669a9df908d8d8859849a0f9fc0fb287561a4e449c21dade10663d42d2ccb",
		["aarch64-unknown-linux-gnu-x86_64-darwin"]:
			"sha256:6979291e34064583ac8b12a8b6b99ec6829caf22f47bcb68b646365ec9e24690",
		["aarch64-unknown-linux-musl-x86_64-darwin"]:
			"sha256:15a7166de1b364e591d6b0206d127b67d15e88555f314170088f5e9ccf0ab068",
		["aarch64-unknown-linux-musl-aarch64-darwin"]:
			"sha256:3f60dbda3b2934857cc63b27e1e680e36b181f3df9bbae9ec207989f47b0e7aa",
		["x86_64-unknown-linux-gnu-aarch64-darwin"]:
			"sha256:bb59598afd84b4d850c32031a4fa64c928fb41f8ece4401553b6c23714efbc47",
		["x86_64-unknown-linux-gnu-x86_64-darwin"]:
			"sha256:86e28c979e5ca6d0d1019c9b991283f2ab430f65cee4dc1e4bdf85170ff7c4f2",
		["x86_64-unknown-linux-musl-x86_64-darwin"]:
			"sha256:ff0f635766f765050dc918764c856247614c38e9c4ad27c30f85c0af4b21e919",
		["x86_64-unknown-linux-musl-aarch64-darwin"]:
			"sha256:de0a12a677f3b91449e9c52a62f3d06c4c1a287aa26ba0bc36f86aaa57c24b55",
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
