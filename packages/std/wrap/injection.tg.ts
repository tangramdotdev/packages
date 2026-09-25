import * as bootstrap from "../bootstrap.tg.ts";
import * as gnu from "../sdk/gnu.tg.ts";
import * as std from "../tangram.ts";
import injectionSource from "./injection" with { type: "directory" };

export type Arg = {
	build?: string | null;
	buildToolchain?: std.env.Arg | null;
	env?: std.env.Arg | null;
	host?: string | null;
	source?: tg.Directory | null;
};

export async function injection(...args: tg.Args<Arg>) {
	const arg = await tg.Args.apply<Arg, tg.ValueOrMaybeMutationMap<Arg>, Arg>({
		args,
		map: async (a) => a,
		reduce: {},
	});

	const host = arg.host ?? std.triple.host();
	const build = arg.build ?? host;
	const os = std.triple.os(host);

	// Get the source.
	const source = arg.source ? arg.source : injectionSource;

	// Get the build toolchain. If not provided, use bootstrap SDK.
	const buildToolchain = arg.buildToolchain ?? (await bootstrap.sdk.env(build));

	// Get any additional env.
	const env = arg?.env;

	// Select the correct toolchain and options for the given triple.
	let additionalArgs: Array<string | tg.Template> = [];
	if (os === "linux") {
		additionalArgs.push(`-Wl,-soname=tangram-injection-${host}.so`);
		if (std.triple.os(build) === "linux") {
			additionalArgs.push("-Wl,--no-as-needed", "-s");
		}
		const injection = tg
			.build(dylib, {
				build,
				buildToolchain,
				...std.args.optional("env", env),
				host,
				source,
				additionalArgs,
			})
			.named("linux injection");
		return injection;
	} else if (os === "darwin") {
		const injection = macOsInjection({
			build,
			buildToolchain,
			...std.args.optional("env", env),
			host,
			source,
		});
		return injection;
	} else {
		return tg.unreachable();
	}
}

type MacOsInjectionArg = {
	build?: string;
	buildToolchain?: std.env.Arg;
	env?: std.env.Arg | null;
	host?: string;
	source: tg.Directory;
};

export async function macOsInjection(arg: MacOsInjectionArg) {
	const host = arg.host ?? std.triple.host();
	const build = arg.build ?? host;
	const os = std.triple.os(host);
	if (os !== "darwin") {
		throw new Error(`Unsupported OS ${os}`);
	}

	const source = arg.source;

	// Get the build toolchain. If not provided, use bootstrap SDK.
	const buildToolchain = arg.buildToolchain ?? (await bootstrap.sdk.env(build));

	// Define common options.
	const additionalArgs = [
		"-Wno-nonnull",
		"-Wno-nullability-completeness",
		`--target=${std.sdk.canonicalTriple(host)}`,
	];
	const env = await std.env.compose(
		{
			MACOSX_DEPLOYMENT_TARGET: std.sdk.macOsDeploymentTarget,
			SDKROOT: tg`${bootstrap.macOsSdk(undefined, build)}/MacOSX.sdk`,
		},
		arg.env ?? null,
	);

	return tg
		.build(dylib, {
			build,
			buildToolchain,
			host,
			source,
			additionalArgs,
			env,
		})
		.named("darwin injection");
}

type DylibArg = {
	additionalArgs: Array<string | tg.Template>;
	build?: string;
	buildToolchain?: std.env.Arg;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export async function dylib(...dylibArgs: tg.Args<DylibArg>): Promise<tg.File> {
	const arg = await tg.Args.apply<
		DylibArg,
		tg.ValueOrMaybeMutationMap<DylibArg>,
		DylibArg
	>({
		args: dylibArgs,
		map: async (a) => a,
		reduce: { additionalArgs: "set", source: "set" },
	});
	const host = arg.host ?? std.triple.host();
	const build = arg.build ?? host;
	const os = std.triple.os(host);
	const source = arg.source;

	// Get the build toolchain. If not provided, use bootstrap SDK.
	const buildToolchain = arg.buildToolchain ?? (await bootstrap.sdk.env(build));
	const toolchainEnv = await std.env.compose(buildToolchain);

	// Find the compiler. Try clang first, then cc, then prefixed cc variants.
	let executable: string | undefined;
	let isClang = false;
	if (await std.env.tryWhich({ env: toolchainEnv, name: "clang" })) {
		executable = "clang";
		isClang = true;
	} else if (await std.env.tryWhich({ env: toolchainEnv, name: "cc" })) {
		executable = "cc";
	} else {
		// Try prefixed variants for cross-compilation or bootstrap toolchains.
		// The bootstrap toolchain uses full canonical triples like x86_64-unknown-linux-gnu-.
		const canonicalHost = std.sdk.canonicalTriple(host);
		const prefixes = [
			`${canonicalHost}-`,
			`${host}-`,
			`${build}-`,
			`${std.sdk.canonicalTriple(build)}-`,
		];
		for (const prefix of prefixes) {
			const name = `${prefix}cc`;
			if (await std.env.tryWhich({ env: toolchainEnv, name })) {
				executable = name;
				break;
			}
		}
	}
	if (!executable) {
		throw new Error(
			`Could not find a C compiler in the toolchain (tried clang, cc, and prefixed variants)`,
		);
	}

	let args: tg.Args<tg.Template.Arg> = [
		"-shared",
		"-fPIC",
		"-ldl",
		"-O3",
		"-pipe",
		"-mtune=generic",
		tg`-I${source}/include`,
	];
	if (!(std.triple.os(build) === "darwin" && std.triple.os(host) === "linux")) {
		args.push("-fstack-protector-strong");
	}

	if (arg.additionalArgs) {
		args = [...args, ...arg.additionalArgs];
	}
	if (std.triple.os(host) === "linux") {
		// On linux build, add these flags.
		if (std.triple.os(build) === "linux") {
			args.push("-fstack-clash-protection");
			if (isClang) {
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

	const system = std.triple.archAndOs(build);
	const output = std
		.build(
			std.shBootstrap`${executable} -xc ${arg.source}/${os}/lib.c -o ${tg.output} ${tg.Template.join(" ", ...args)}`,
		)
		.env(
			buildToolchain,
			{
				// Ensure the linker proxy is always skipped, whether or not the toolchain is proxied.
				TANGRAM_LINKER_PASSTHROUGH: true,
			},
			...(arg.env !== undefined ? [arg.env] : []),
		)
		.host(system)
		.then(tg.File.expect);
	return output;
}

export async function test() {
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
		tg.assert(nativeMetadata.format === "mach-o");
		tg.assert(
			nativeMetadata.arches.length === 1 && nativeMetadata.arches[0] === hostArch,
		);
	} else {
		return tg.unreachable();
	}
	return nativeInjection;
}

/** The default injection library built with the default SDK for the detected host. This version uses the default SDK to ensure cache hits when used throughout the codebase. */
export async function defaultInjection() {
	const host = std.triple.host();
	const buildToolchain = await bootstrap.sdk.env(host);
	return tg
		.build(injection, {
			buildToolchain,
			host,
		})
		.named("default injection");
}

/** Release helper - builds defaultInjection with a referent to this file for cache hits. */
export async function buildDefaultInjection() {
	return tg.build(defaultInjection).named("default injection");
}

export async function testCross() {
	const detectedHost = std.triple.host();
	const os = std.triple.os(detectedHost);
	const hostArch = std.triple.arch(detectedHost);
	const targetArch = hostArch === "x86_64" ? "aarch64" : "x86_64";
	const target = std.sdk.canonicalTriple(`${targetArch}-${os}`);
	const buildToolchain =
		os === "darwin"
			? bootstrap.sdk.env(detectedHost)
			: gnu.toolchain({ host: detectedHost, target });

	const nativeInjection = await tg.build(injection, {
		build: detectedHost,
		buildToolchain,
		host: target,
	});

	// Assert the injection dylib was built for the target machine.
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
		tg.assert(nativeMetadata.format === "mach-o");
		tg.assert(
			nativeMetadata.arches.length === 1 && nativeMetadata.arches[0] === targetArch,
		);
	} else {
		return tg.unreachable();
	}
}

/** The tests in this module, grouped by tier. */
export const tests = {
	bootstrap: [test],
	extended: [testCross],
};
