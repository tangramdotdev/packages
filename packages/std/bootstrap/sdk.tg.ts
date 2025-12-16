import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";

/** Produce a std.sdk() consisting only of components from the bootstrap bundles, with the `ld` proxy enabled. Will not compile any utilities or toolchains. */
export async function sdk(host?: string) {
	return await tg.build(std.sdk, sdk.arg(host)).named("bootstrap sdk");
}

export namespace sdk {
	/** Produce the arg object to create a bootstrap-only SDK. */
	export const arg = async (hostArg?: string): Promise<std.sdk.Arg> => {
		const host = bootstrap.toolchainTriple(hostArg);
		const toolchain = await env(host);
		return { host, toolchain };
	};

	/** Get a build environment containing only the components from the pre-built bootstrap artifacts with no proxies. Instead of using this env directly, consider using `std.sdk({ bootstrapMode: true })`, which can optionally include the linker and/or cc proxies. */
	export const env = async (hostArg: string) => {
		const host = hostArg ?? std.triple.host();
		const os = std.triple.os(host);
		let toolchain = await bootstrap.toolchain(host);
		if (os === "darwin") {
			toolchain = await tg.directory(toolchain, {
				["bin/gcc"]: tg.symlink("clang"),
				["bin/g++"]: tg.symlink("clang++"),
			});
		}
		const bootstrapHost = bootstrap.toolchainTriple(host);
		const utils = await prepareBootstrapUtils(bootstrapHost);
		return await tg.directory(toolchain, utils);
	};

	/** Combine the busybox/toybox artifact with the dash shell from the bootstrap. */
	export const prepareBootstrapUtils = async (hostArg?: string) => {
		const host = hostArg ?? std.triple.host();
		const shell = await bootstrap.shell(host);
		const shellFile = await shell.get("bin/dash").then(tg.File.expect);
		const utils = bootstrap.utils(host);
		const combined = await tg.directory(utils, {
			"bin/dash": shellFile,
			"bin/sh": tg.symlink("dash"),
		});
		return combined;
	};
}

export const test = async () => {
	const sdkEnv = await sdk();
	const arg = await sdk.arg();
	await std.sdk.assertValid(sdkEnv, arg);
	return sdkEnv;
};
