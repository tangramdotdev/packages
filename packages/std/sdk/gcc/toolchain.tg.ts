/** This package takes a bootstrap C/C++ compiler and some utilities and canadian-crosses up a sizzling plate of farm-fresh GCC. The output of this package can then be used to build other compilers like LLVM. */

import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.tg.ts";
import binutils from "../binutils.tg.ts";
import * as gcc from "../gcc.tg.ts";
import kernelHeaders from "../kernel_headers.tg.ts";
import { constructSysroot } from "../libc.tg.ts";
import * as proxy from "../proxy.tg.ts";

export type ToolchainArg = std.sdk.BuildEnvArg & {
	target?: string;
};

/** Construct a complete binutils + libc + gcc toolchain. */
export let toolchain = tg.target(async (arg: ToolchainArg) => {
	let { host: host_, target: target_, ...rest } = arg;
	let host = std.sdk.canonicalTriple(host_ ?? (await std.triple.host()));
	let target = std.sdk.canonicalTriple(target_ ?? host);

	// Always build a native toolchain.
	let nativeToolchain = await canadianCross(host);

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
		...rest,
		build: host, // We've produced a native toolchain, so we can use it to build the cross-toolchain.
		env: [nativeToolchain, nativeProxyEnv],
		host,
		sdk: false,
		target,
		variant: "stage2_full",
	});

	return env;
});

type CrossToolchainArg = std.sdk.BuildEnvArg & {
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
	console.log("buildBinutils", await buildBinutils.id());
	console.log("crossBinutils", await crossBinutils.id());

	let sysroot =
		sysroot_ ??
		(await buildSysroot({
			build: buildTriple,
			env: [env_, buildBinutils, crossBinutils],
			host: target,
			sdk,
		}));

	// Produce a toolchain containing the sysroot and a cross-compiler.
	let crossGCC = await gcc.build({
		build: buildTriple,
		env: [env_, buildBinutils, crossBinutils],
		host,
		sdk,
		sysroot,
		target,
		variant,
	});
	console.log("cross gcc", await crossGCC.id());

	let combined = await tg.directory(crossGCC, sysroot);
	console.log("combined cross toolchain", await combined.id());

	return { env: [combined, buildBinutils, crossBinutils], sysroot };
});

export let buildSysroot = tg.target(async (arg: std.sdk.BuildEnvArg) => {
	let { build: build_, env, host: host_, ...rest } = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let buildTriple = build_ ?? host;
	let target = host;

	// Produce the linux headers.
	let linuxHeaders = await tg.directory({
		include: await kernelHeaders({
			...rest,
			build: buildTriple,
			env,
			host: target,
		}),
	});
	console.log("linuxHeaders", await linuxHeaders.id());

	let linuxHeadersSysroot = await tg.directory({
		[target]: linuxHeaders,
	});

	// Produce the initial gcc required to build the standard C library.
	let bootstrapGCC = await gcc.build({
		...rest,
		build: buildTriple,
		env,
		host: buildTriple,
		sysroot: linuxHeadersSysroot,
		target,
		variant: "stage1_bootstrap",
	});
	console.log("bootstrapGCC", await bootstrapGCC.id());

	// Produce a combined directory containing the correct C library for the host and the Linux headers.
	let sysroot = await constructSysroot({
		...rest,
		build: buildTriple,
		host,
		linuxHeaders,
		env: [env, bootstrapGCC],
	});
	console.log("sysroot", await sysroot.id());
	return sysroot;
});

export let canadianCross = tg.target(async (hostArg?: string) => {
	let host = std.sdk.canonicalTriple(hostArg ?? (await std.triple.host()));

	let target = host;
	let build = bootstrap.toolchainTriple(host);

	let sdkArg = bootstrap.sdk.arg(host);

	// Create cross-toolchain from build to host.
	let { env, sysroot } = await buildToHostCrossToolchain(host);

	// Create a native toolchain (host to host).
	let nativeHostBinutils = await binutils({
		env,
		sdk: sdkArg,
		build,
		host,
		staticBuild: true,
		target,
	});
	console.log("stage2 binutils", await nativeHostBinutils.id());

	let fullGCC = await gcc.build({
		build,
		debug: true,
		env: [env, nativeHostBinutils],
		host,
		sysroot,
		sdk: sdkArg,
		target,
		variant: "stage2_full",
	});
	console.log("stage2 gcc", await fullGCC.id());

	// Flatten the sysroot and combine into a native toolchain.
	let innerSysroot = tg.Directory.expect(await sysroot.get(target));
	let combined = await tg.directory(fullGCC, innerSysroot);
	console.log("combined native toolchain", await combined.id());
	return [combined, nativeHostBinutils];
});

export let buildToHostCrossToolchain = async (hostArg?: string) => {
	let host = std.sdk.canonicalTriple(hostArg ?? (await std.triple.host()));
	let build = bootstrap.toolchainTriple(host);

	let sdkArg = bootstrap.sdk.arg(host);

	// Create cross-toolchain from build to host.
	return crossToolchain({
		build,
		sdk: sdkArg,
		host: build,
		target: host,
		variant: "stage1_limited",
	});
};

export let testStage1 = async () => {
	let host = await std.triple.host();
	let build = await bootstrap.toolchainTriple(host);
	let { env } = await buildToHostCrossToolchain(host);
	await std.sdk.assertValid(env, { host: build, target: host });
	return env;
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
