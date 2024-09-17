import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";

/** Produce a std.sdk() consisting only of components from the bootstrap bundles, with the `ld` proxy enabled. Will not compile any utilities or toolchains. */
export async function sdk(host?: string) {
	return std.sdk(sdk.arg(host));
}

export namespace sdk {
	/** Produce the arg object to create a bootstrap-only SDK. */
	export const arg = async (hostArg?: string): Promise<std.sdk.Arg> => {
		const host = await bootstrap.toolchainTriple(hostArg);
		const toolchain = await env(host);
		return { host, toolchain };
	};

	/** Get a build environment containing only the components from the pre-built bootstrap artifacts with no proxies. Instead of using this env directly, consider using `std.sdk({ bootstrapMode: true })`, which can optionally include the linker and/or cc proxies. */
	export const env = async (hostArg?: string) => {
		const host = hostArg ?? (await std.triple.host());
		const toolchain = await prepareBootstrapToolchain(host);
		const bootstrapHost = await bootstrap.toolchainTriple(host);
		const utils = await prepareBootstrapUtils(bootstrapHost);
		const shellExe = await utils.get("bin/dash").then(tg.File.expect);
		let env: std.env.Arg = {
			CONFIG_SHELL: shellExe,
			SHELL: shellExe,
		};
		if (std.triple.os(host) === "darwin") {
			const sdkroot = await tg.Mutation.setIfUnset(bootstrap.macOsSdk());
			env = {
				...env,
				SDKROOT: sdkroot,
			};
		}
		return await std.env.arg(toolchain, utils, env);
	};

	/** Get the bootstrap components as a single directory, for use before SDK. */
	export const prepareBootstrapToolchain = async (hostArg?: string) => {
		// Detect the host triple if not provided.
		const host = hostArg ?? (await std.triple.host());
		const os = std.triple.os(host);

		// Obtain the bootstrap toolchain and triple for the detected host to construct the env.
		let bootstrapToolchain = await bootstrap.toolchain(host);

		if (os === "darwin") {
			// Replace the Xcode-tied gcc and g++ entries with symlinks to clang and return.
			bootstrapToolchain = await tg.directory(bootstrapToolchain, {
				["bin/gcc"]: tg.symlink("clang"),
				["bin/g++"]: tg.symlink("clang++"),
			});
		} else if (os === "linux") {
			// Nothing to do.
		} else {
			throw new Error(`Unsupported host OS: ${os}.`);
		}

		return bootstrapToolchain;
	};

	/** Combine the busybox/toybox artifact with the dash shell from the bootstrap. */
	export const prepareBootstrapUtils = async (hostArg?: string) => {
		const host = hostArg ?? (await std.triple.host());
		const shell = await bootstrap.shell(host);
		const shellFile = await shell.get("bin/dash").then(tg.File.expect);
		const utils = bootstrap.utils(host);
		const combined = tg.directory(utils, {
			"bin/dash": shellFile,
			"bin/sh": tg.symlink("dash"),
		});
		return combined;
	};

	export const prefixBins = async (
		dir: tg.Directory,
		bins: Array<string>,
		prefix: string,
	): Promise<tg.Directory> => {
		let ret = dir;
		for (const bin of bins) {
			if (!ret.tryGet(`bin/${bin}`)) {
				throw new Error(`Could not locate bin/${bin}.`);
			}
			ret = await tg.directory(ret, {
				bin: {
					[`${prefix}${bin}`]: tg.symlink(`${bin}`),
				},
			});
		}
		return ret;
	};

	export const test = async () => {
		const sdkEnv = await sdk();
		const arg = await sdk.arg();
		await std.sdk.assertValid(sdkEnv, arg);
		return sdkEnv;
	};
}
