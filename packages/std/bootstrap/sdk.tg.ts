import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";

/** Get a build environment containing only the components from the pre-built bootstrap artifacts with no proxying. Instead of using this env directly, consider using `std.sdk({ bootstrapMode: true })`, which can optionally include the linker and/or cc proxies. */
export let env = async (hostArg?: string): Promise<std.env.Arg> => {
	let host = hostArg ?? (await std.triple.host());
	let toolchain = await prepareBootstrapToolchain(host);
	let bootstrapHost = bootstrap.toolchainTriple(host);
	let utils = await prepareBootstrapUtils(bootstrapHost);
	let shellExe = tg.File.expect(await utils.get("bin/dash"));
	let env: tg.MutationMap<Record<string, tg.Template.Arg>> = {
		CONFIG_SHELL: shellExe,
		SHELL: shellExe,
	};
	if (std.triple.os(host) === "darwin") {
		let sdkroot = await tg.Mutation.setIfUnset(bootstrap.macOsSdk());
		env = {
			...env,
			SDKROOT: sdkroot,
		};
	}
	return std.env.object(toolchain, utils, env);
};

export default env;

/** Get the bootstrap components as a single directory, for use before SDK. */
export let prepareBootstrapToolchain = async (hostArg?: string) => {
	// Detect the host triple if not provided.
	let host = hostArg ?? (await std.triple.host());
	let os = std.triple.os(host);

	// Obtain the bootstrap toolchain and triple for the detected host to construct the env.
	let bootstrapToolchain = await bootstrap.toolchain({ host });
	let bootstrapTriple = bootstrap.toolchainTriple(host);

	if (os === "darwin") {
		// Replace the Xcode-tied gcc and g++ entries with symlinks to clang and return.
		bootstrapToolchain = await tg.directory(bootstrapToolchain, {
			["bin/gcc"]: tg.symlink("clang"),
			["bin/g++"]: tg.symlink("clang++"),
		});
	} else if (os === "linux") {
		// Add prefixed symlinks for the included binutils.
		bootstrapToolchain = await prefixBins(
			bootstrapToolchain,
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
			bootstrapTriple + "-",
		);
	} else {
		throw new Error(`Unsupported host OS: ${os}.`);
	}

	return bootstrapToolchain;
};

/** Combine the busybox/toybox artifact with the dash shell from the bootstrap. */
export let prepareBootstrapUtils = async (hostArg?: string) => {
	let host = hostArg ?? (await std.triple.host());
	let shell = await bootstrap.shell({ host });
	let shellFile = tg.File.expect(await shell.get("bin/dash"));
	let utils = bootstrap.utils({ host });
	let combined = tg.directory(utils, {
		"bin/dash": shellFile,
		"bin/sh": tg.symlink("dash"),
	});
	return combined;
};

export let prefixBins = async (
	dir: tg.Directory,
	bins: Array<String>,
	prefix: string,
): Promise<tg.Directory> => {
	let ret = dir;
	for (let bin of bins) {
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

export let test = tg.target(async () => {
	let sdk = await env();
	let detectedHost = await std.triple.host();
	let expectedHost = bootstrap.toolchainTriple(detectedHost);
	await std.sdk.assertValid(sdk, { host: expectedHost, bootstrapMode: true });
	return sdk;
});
