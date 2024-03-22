/** This package takes a bootstrap C/C++ compiler and some utilities and canadian-crosses up a sizzling plate of farm-fresh GCC. The output of this package can then be used to build other compilers like LLVM. */

import * as bootstrap from "../../bootstrap.tg.ts";
import { normalizeTriple } from "../../sdk.tg.ts";
import * as std from "../../tangram.tg.ts";
import binutils from "../binutils.tg.ts";
import * as dependencies from "../dependencies.tg.ts";
import * as gcc from "../gcc.tg.ts";
import kernelHeaders from "../kernel_headers.tg.ts";
import { constructSysroot } from "../libc.tg.ts";
import * as proxy from "../proxy.tg.ts";

export type ToolchainArg = std.sdk.BuildEnvArg & {
	target?: tg.Triple.Arg;
};

/** Construct a complete binutils + libc + gcc toolchain. */
export let toolchain = tg.target(async (arg: ToolchainArg) => {
	let { host: host_, target: target_, ...rest } = arg;
	let host = normalizeTriple(host_ ? tg.triple(host_) : await tg.Triple.host());
	let target = normalizeTriple(target_ ? tg.triple(target_) : host);

	// Always build a native toolchain.
	let nativeToolchain = await canadianCross({ host });

	// If only the native toolchain was requested, return it.
	if (tg.Triple.eq(host, target)) {
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
		bootstrapMode: true,
		build: host, // We've produced a native toolchain, so we can use it to build the cross-toolchain.
		env: [nativeToolchain, nativeProxyEnv],
		host,
		target,
		variant: "stage2_full",
	});

	return env;
});

type CrossToolchainArg = std.sdk.BuildEnvArg & {
	sysroot?: tg.Directory;
	target: tg.Triple.Arg;
	variant?: gcc.Variant;
};

export let crossToolchain = tg.target(async (arg: CrossToolchainArg) => {
	let {
		build: build_,
		host: host_,
		sysroot: sysroot_,
		target: target_,
		variant = "stage2_full",
		...rest
	} = arg ?? {};

	let host = host_ ? tg.triple(host_) : await tg.Triple.host();
	let buildTriple = build_ ? tg.triple(build_) : host;
	let target = target_ ? tg.triple(target_) : host;

	// Produce the binutils.
	let crossBinutils = await binutils({
		...rest,
		build: buildTriple,
		host,
		target,
	});
	console.log("crossBinutils", await crossBinutils.id());

	let sysroot =
		sysroot_ ??
		(await buildSysroot({
			...rest,
			build: buildTriple,
			crossBinutils,
			host: target,
		}));

	// Produce a toolchain containing the sysroot and a cross-compiler.
	let crossGCC = await gcc.build({
		...rest,
		binutils: crossBinutils,
		build: buildTriple,
		host,
		sysroot,
		target,
		variant,
	});
	console.log("cross gcc", await crossGCC.id());

	return { env: crossGCC, sysroot };
});

type BuildSysrootArg = std.sdk.BuildEnvArg & {
	crossBinutils?: tg.Directory;
};

export let buildSysroot = tg.target(async (arg: BuildSysrootArg) => {
	let {
		build: build_,
		crossBinutils: crossBinutils_,
		env,
		host: host_,
		...rest
	} = arg ?? {};

	let host = host_ ? tg.triple(host_) : await tg.Triple.host();
	let buildTriple = build_ ? tg.triple(build_) : host;
	let target = host;

	let crossBinutils =
		crossBinutils_ ??
		(await binutils({ ...rest, build: buildTriple, env, host, target }));

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
		[tg.Triple.toString(target)]: linuxHeaders,
	});

	// Produce the initial gcc required to build the standard C library.
	let bootstrapGCC = await gcc.build({
		...rest,
		binutils: crossBinutils,
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
		env: bootstrapGCC,
		target,
	});
	console.log("sysroot", await sysroot.id());
	return sysroot;
});

export let canadianCross = tg.target(async (arg?: tg.Triple.HostArg) => {
	let host = await tg.Triple.host(arg);

	let target = host;
	let build = bootstrap.toolchainTriple(host);

	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });

	await dependencies.env({ host: build, bootstrapMode, env: sdk });

	// Create cross-toolchain from build to host.
	let { env, sysroot } = await buildToHostCrossToolchain({ host });

	// Create a native toolchain (host to host).
	let nativeHostBinutils = await binutils({
		env: [env, sdk],
		bootstrapMode,
		build,
		host,
		staticBuild: true,
		target,
	});
	nativeHostBinutils = await bootstrap.sdk.prefixBins(
		nativeHostBinutils,
		[
			"addr2line",
			"ar",
			"as",
			"ld",
			"nm",
			"objcopy",
			"objdump",
			"ranlib",
			"readelf",
			"strip",
			"strings",
		],
		tg.Triple.toString(host) + "-",
	);
	console.log("stage2 binutils", await nativeHostBinutils.id());

	let fullGCC = await gcc.build({
		binutils: nativeHostBinutils,
		bootstrapMode,
		build,
		env: [env, sdk],
		host,
		sysroot,
		target,
		variant: "stage2_full",
	});
	console.log("stage2 gcc", await fullGCC.id());

	// Return just the directory.
	return fullGCC;
});

export let buildToHostCrossToolchain = async (arg: tg.Triple.HostArg) => {
	let host = await tg.Triple.host(arg);
	let build = bootstrap.toolchainTriple(host);

	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });

	// Create cross-toolchain from build to host.
	let { env, sysroot } = await crossToolchain({
		bootstrapMode,
		build,
		env: sdk,
		host: build,
		target: host,
		variant: "stage1_limited",
	});

	return { env, sysroot };
};

export let testStage1 = async () => {
	let host = await tg.Triple.host();
	let build = bootstrap.toolchainTriple(host);
	let env = await buildToHostCrossToolchain({ host });
	await std.sdk.assertValid(env, { host: build, target: host });
	return true;
};

export let testCanadianCross = async () => {
	let toolchainDir = await canadianCross();
	return toolchainDir;
};

export let testCross = async () => {
	let host = await tg.Triple.host();
	let hostArch = host.arch;
	let targetArch: tg.Triple.Arch = hostArch === "x86_64" ? "aarch64" : "x86_64";
	let target = tg.triple({ ...host, arch: targetArch });
	let dir = await toolchain({ host, target });
	return dir;
};

export let testCrossRpi = async () => {
	let host = await tg.Triple.host();
	let target = tg.triple("armv7l-linux-gnueabihf");
	let dir = await toolchain({ host, target });
	return dir;
};
