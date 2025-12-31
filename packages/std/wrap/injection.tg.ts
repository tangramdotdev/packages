import * as bootstrap from "../bootstrap.tg.ts";
import * as gnu from "../sdk/gnu.tg.ts";
import * as std from "../tangram.ts";
import injectionSource from "./injection" with { type: "directory" };

export type Arg = {
	build?: string | undefined;
	buildToolchain?: std.env.Arg;
	env?: std.env.Arg;
	host?: string;
	source?: tg.Directory;
};

export const injection = async (unresolved?: tg.Unresolved<Arg>) => {
	const arg = await tg.resolve(unresolved);

	const host = arg?.host ?? std.triple.host();
	const build = arg?.build ?? host;
	const os = std.triple.os(host);

	// Get the source.
	const sourceDir = arg?.source ? arg.source : injectionSource;
	const source = await sourceDir.get(`${os}/lib.c`).then(tg.File.expect);

	// Get the build toolchain. If not provided, use bootstrap SDK.
	const buildToolchain = arg?.buildToolchain ?? (await bootstrap.sdk.env(host));

	// Get any additional env.
	const env = arg?.env;

	// Select the correct toolchain and options for the given triple.
	let additionalArgs: Array<string | tg.Template> = [];
	if (os === "linux") {
		if (std.triple.os(build) === "linux") {
			additionalArgs.push("-Wl,--no-as-needed", "-s");
		}
		const injection = tg
			.build(dylib, {
				build,
				buildToolchain,
				env,
				host,
				source,
				additionalArgs,
			})
			.named("linux injection");
		return injection;
	} else if (os === "darwin") {
		const injection = macOsInjection({
			buildToolchain,
			env,
			host,
			source,
		});
		return injection;
	} else {
		return tg.unreachable();
	}
};

type MacOsInjectionArg = {
	buildToolchain?: std.env.Arg;
	env?: std.env.Arg;
	host?: string;
	source: tg.File;
};

export const macOsInjection = async (arg: MacOsInjectionArg) => {
	const host = arg.host ?? std.triple.host();
	const os = std.triple.os(host);
	if (os !== "darwin") {
		throw new Error(`Unsupported OS ${os}`);
	}

	const source = arg.source;

	// Get the build toolchain. If not provided, use bootstrap SDK.
	const buildToolchain = arg.buildToolchain ?? (await bootstrap.sdk.env(host));

	// Define common options.
	const additionalArgs = ["-Wno-nonnull", "-Wno-nullability-completeness"];
	const env = await std.env.arg(
		{
			SDKROOT: await bootstrap.macOsSdk(),
		},
		arg.env,
		{ utils: false },
	);

	// Compile arm64 dylib.
	const arm64Args = additionalArgs.concat(["--target=aarch64-apple-darwin"]);
	const arm64injection = await tg
		.build(dylib, {
			buildToolchain,
			source,
			additionalArgs: arm64Args,
			env,
		})
		.named("arm64 injection");

	// Compile amd64 dylib.
	const amd64Args = additionalArgs.concat(["--target=x86_64-apple-darwin"]);
	const amd64injection = await tg
		.build(dylib, {
			buildToolchain,
			source,
			additionalArgs: amd64Args,
			env,
		})
		.named("amd64 injection");

	// Combine into universal dylib.
	const system = std.triple.archAndOs(host);
	const injection =
		await std.build`lipo -create ${arm64injection} ${amd64injection} -output ${tg.output}`
			.bootstrap(true)
			.host(system)
			.env(buildToolchain)
			.env(env)
			.named("universal injection")
			.then(tg.File.expect);
	return injection;
};

type DylibArg = {
	additionalArgs: Array<string | tg.Template>;
	build?: string;
	buildToolchain?: std.env.Arg;
	env?: std.env.Arg;
	host?: string;
	source: tg.File;
};

export const dylib = async (arg: DylibArg): Promise<tg.File> => {
	const host = arg.host ?? std.triple.host();
	const build = arg.build ?? host;

	// Get the build toolchain. If not provided, use bootstrap SDK.
	const buildToolchain = arg.buildToolchain ?? (await bootstrap.sdk.env(host));
	// On macOS builds, the compiler is clang, so no triple prefix.
	const useTriplePrefix = std.triple.os(build) === "linux" && build !== host;
	let args: std.Args<tg.Template.Arg> = [
		"-shared",
		"-fPIC",
		"-ldl",
		"-O3",
		"-pipe",
		"-mtune=generic",
	];
	if (!(std.triple.os(build) === "darwin" && std.triple.os(host) === "linux")) {
		args.push("-fstack-protector-strong");
	}

	if (arg.additionalArgs) {
		args = [...args, ...arg.additionalArgs];
	}
	if (std.triple.os(host) === "linux") {
		const toolchainEnv = await std.env.arg(buildToolchain, {
			utils: false,
		});
		// On linux build, add these flags.
		if (std.triple.os(build) === "linux") {
			args.push("-fstack-clash-protection");
			if (await std.env.tryWhich({ env: toolchainEnv, name: "clang" })) {
				args.push("-fuse-ld=lld");
			}
		}
		if (std.triple.os(build) === "darwin") {
			const { directory } = await std.sdk.toolchainComponents({
				env: toolchainEnv,
			});
			args.push(
				"-v",
				"-target",
				host,
				"-fuse-ld=lld",
				"--sysroot",
				tg`${directory}/${host}/sysroot`,
			);
		}
	}

	const prefix = useTriplePrefix ? `${host}-` : "";
	const executable = `${prefix}cc`;

	const system = std.triple.archAndOs(build);
	const env = std.env.arg(
		buildToolchain,
		{
			// Ensure the linker proxy is always skipped, whether or not the toolchain is proxied.
			TGLD_PASSTHROUGH: true,
		},
		arg.env,
		{ utils: false },
	);
	const output =
		std.build`${executable} -xc ${arg.source} -o ${tg.output} ${tg.Template.join(" ", ...args)}`
			.bootstrap(true)
			.env(env)
			.host(system)
			.then(tg.File.expect);
	return output;
};

export const test = async () => {
	const detectedHost = std.triple.host();
	const hostArch = std.triple.arch(detectedHost);
	tg.assert(hostArch);
	const buildToolchain = bootstrap.sdk.env(detectedHost);
	const nativeInjection = await tg.build(injection, {
		host: detectedHost,
		buildToolchain,
	});

	// Assert the native injection dylib was built for the build machine.
	const os = std.triple.os(std.triple.archAndOs(detectedHost));
	const nativeMetadata = await std.file.executableMetadata(nativeInjection);
	if (os === "linux") {
		std.assert.assertJsonSnapshot(
			nativeMetadata,
			`
			{
				"format": "elf",
				"arch": "${hostArch}"
			}
		`,
		);
	} else if (os === "darwin") {
		std.assert.assertJsonSnapshot(
			nativeMetadata,
			`
			{
				"format": "mach-o",
				"arches": ["${hostArch}"]
			}
		`,
		);
	} else {
		return tg.unreachable();
	}
	return nativeInjection;
};

/** The default injection library built with the default SDK for the detected host. This version uses the default SDK to ensure cache hits when used throughout the codebase. */
export const defaultInjection = async () => {
	const host = std.triple.host();
	const buildToolchain = await bootstrap.sdk.env(host);
	return tg
		.build(injection, {
			buildToolchain,
			host,
		})
		.named("default injection");
};

/** Release helper - builds defaultInjection with a referent to this file for cache hits. */
export const buildDefaultInjection = async () => {
	return tg.build(defaultInjection).named("default injection");
};

export const testCross = async () => {
	const detectedHost = std.triple.host();
	if (std.triple.os(detectedHost) === "darwin") {
		console.log("Skipping cross test on darwin");
		return true;
	}

	const hostArch = std.triple.arch(detectedHost);
	const targetArch = hostArch === "x86_64" ? "aarch64" : "x86_64";
	const target = `${targetArch}-unknown-linux-gnu`;
	const buildToolchain = gnu.toolchain({ host: detectedHost, target });

	const nativeInjection = await tg.build(injection, {
		build: detectedHost,
		buildToolchain,
		host: target,
	});

	// Assert the injection dylib was built for the target machine.
	const os = std.triple.os(std.triple.archAndOs(detectedHost));
	const nativeMetadata = await std.file.executableMetadata(nativeInjection);
	if (os === "linux") {
		std.assert.assertJsonSnapshot(
			nativeMetadata,
			`
			{
				"format": "elf",
				"arch": "${targetArch}"
			}
		`,
		);
	} else if (os === "darwin") {
		std.assert.assertJsonSnapshot(
			nativeMetadata,
			`
			{
				"format": "mach-o",
				"arches": ["${targetArch}"]
			}
		`,
		);
	} else {
		return tg.unreachable();
	}
};
