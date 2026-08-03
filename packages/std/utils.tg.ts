import * as bootstrap from "./bootstrap.tg.ts";
import * as bootstrapSdk from "./bootstrap/sdk.tg.ts";
import * as std from "./tangram.ts";
import * as bash from "./utils/bash.tg.ts";
import bzip2 from "./utils/bzip2.tg.ts";
import coreutils, * as coreutilsNs from "./utils/coreutils.tg.ts";
import diffutils from "./utils/diffutils.tg.ts";
import findutils from "./utils/findutils.tg.ts";
import gawk from "./utils/gawk.tg.ts";
import grep from "./utils/grep.tg.ts";
import gzip from "./utils/gzip.tg.ts";
import make from "./utils/make.tg.ts";
import patch from "./utils/patch.tg.ts";
import sed from "./utils/sed.tg.ts";
import tar from "./utils/tar.tg.ts";
import xz from "./utils/xz.tg.ts";

export * as attr from "./utils/attr.tg.ts";
export * as bzip2 from "./utils/bzip2.tg.ts";
export * as bash from "./utils/bash.tg.ts";
export * as coreutils from "./utils/coreutils.tg.ts";
export * as diffutils from "./utils/diffutils.tg.ts";
export * as fileCmds from "./utils/file_cmds.tg.ts";
export * as findutils from "./utils/findutils.tg.ts";
export * as gawk from "./utils/gawk.tg.ts";
export * as grep from "./utils/grep.tg.ts";
export * as gzip from "./utils/gzip.tg.ts";
export * as libiconv from "./utils/libiconv.tg.ts";
export * as make from "./utils/make.tg.ts";
export * as patch from "./utils/patch.tg.ts";
export * as sed from "./utils/sed.tg.ts";
export * as tar from "./utils/tar.tg.ts";
export * as xz from "./utils/xz.tg.ts";

export type Arg = {
	build?: string | null;
	/** The environment carrying the toolchain these utilities are built with. These builds add no SDK of their own, so it must provide a compiler. */
	env?: std.env.Arg | null;
	host?: string | null;
};

/** A basic set of GNU system utilites. */
export async function env(...args: tg.Args<Arg>) {
	const {
		build,
		env: env_,
		host: host_,
	} = await tg.Args.apply<Arg, tg.ValueOrMaybeMutationMap<Arg>, Arg>({
		args,
		map: async (arg) => arg,
		reduce: {},
	});
	const host = host_ ?? std.triple.host();

	// These are the utilities a managed SDK itself depends on, so none of them may ask for one. The compiler comes from the given environment, which falls back to the bootstrap toolchain.
	const toolchainEnv = env_ ?? (await bootstrapSdk.sdk(host));

	const shellArtifact = await bash.build({
		build: build ?? null,
		env: toolchainEnv,
		host,
		sdk: "none",
	});
	const env = await std.env.compose(toolchainEnv);
	const commonArg = {
		build: build ?? null,
		env,
		host,
		sdk: "none" as const,
	};

	let utils = [shellArtifact];
	utils = utils.concat(
		await Promise.all([
			bzip2(commonArg),
			coreutils(commonArg),
			diffutils(commonArg),
			findutils(commonArg),
			gawk(commonArg),
			grep(commonArg),
			gzip(commonArg),
			make(commonArg),
			patch(commonArg),
			sed(commonArg),
			tar(commonArg),
			xz(commonArg),
		]),
	);
	return await std.env.compose(...utils);
}

export default env;

/** The standard utils built with the default SDK for the detected host. This version uses the default SDK to ensure cache hits when used throughout the codebase. */
export async function defaultEnv() {
	const host = std.sdk.canonicalTriple(std.triple.host());
	const sdk = await tg.build(std.sdk, { host }).named("sdk");
	return tg.build(env, { host, env: sdk }).named("default utils");
}

/** Release helper - builds defaultEnv with a referent to this file for cache hits. */
export async function buildDefaultEnv() {
	return tg.build(defaultEnv).named("default env");
}

/** All utils builds must begin with these prerequisites in the build environment, which include patched `cp` and `install` commands that always preseve extended attributes.*/
export async function prerequisites(hostArg?: tg.Unresolved<string>) {
	const rawHost = hostArg ? await tg.resolve(hostArg) : std.triple.host();
	const host = bootstrap.toolchainTriple(rawHost);

	// Add GNU make.
	const makeArtifact = await tg
		.build(bootstrap.make.build, { host })
		.named("bootstrap make");

	// Add patched GNU coreutils, sharing the cache with gnuEnv().
	const coreutilsArtifact = await coreutilsNs.bootstrapBuild(host);

	// Order matters: items later in the array prepend to PATH later, so they appear first.
	// We want coreutils first, then make. The SDK provides baseline utils (busybox/toybox) at lowest precedence.
	const components: tg.Args<std.env.Arg> = [
		bootstrap.sdk.prepareBootstrapUtils(host),
		makeArtifact,
		coreutilsArtifact,
	];

	return std.env.compose(...components);
}

export type BuildUtilArg = Omit<std.autotools.Arg, "deps"> & {
	/** Wrap the scripts in the output at the specified paths with bash as the interpreter. */
	wrapBashScriptPaths?: Array<string>;
};

/** Build a util. This wraps std.phases.autotools.build(), adding the wrapBashScriptPaths post-process step and disabling extra tools. */
export async function autotoolsInternal(arg: tg.Unresolved<BuildUtilArg>) {
	const {
		extended = false,
		pkgConfig = false,
		wrapBashScriptPaths,
		...rest
	} = await tg.resolve(arg);
	let output = await std.autotools.build({
		...rest,
		extended,
		pkgConfig,
	});
	for (const path of wrapBashScriptPaths ?? []) {
		const file = tg.File.expect(await output.get(path));
		const wrappedFile = changeShebang(file);
		output = await tg.directory(output, {
			[path]: wrappedFile,
		});
	}
	return output;
}

/** Given a file containing a shell script, change the given shebang to use /usr/bin/env.  The SDK will place bash on the path.  */
export async function changeShebang(scriptFile: tg.File) {
	// Ensure the file has a shebang.
	const metadata = await std.file.executableMetadata(scriptFile);
	tg.assert(metadata.format === "shebang");

	// Replace the first line with a new shebang.
	const fileContents = await scriptFile.text;
	const firstNewlineIndex = fileContents.indexOf("\n");
	if (firstNewlineIndex === -1) {
		return tg.unreachable(
			"Could not find newline in file contents, but we asserted it begins with a shebang.",
		);
	}
	const fileWithoutShebangLine = fileContents.substring(firstNewlineIndex + 1);
	const newFileContents = `#!/usr/bin/env bash\n${fileWithoutShebangLine}`;
	const newFile = tg.file({ contents: newFileContents, executable: true });
	return newFile;
}

export async function test() {
	const host = bootstrap.toolchainTriple(std.triple.host());
	const utilsEnv = await env({ host, env: bootstrap.sdk() });
	tg.assert(await std.env.providesUtils(utilsEnv));
	return utilsEnv;
}

export async function testPrerequisites() {
	const host = bootstrap.toolchainTriple(std.triple.host());
	return await prerequisites(host);
}
