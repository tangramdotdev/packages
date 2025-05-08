import * as bootstrap from "./bootstrap.tg.ts";
import * as std from "./tangram.ts";
import * as bash from "./utils/bash.tg.ts";
import bzip2 from "./utils/bzip2.tg.ts";
import coreutils from "./utils/coreutils.tg.ts";
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
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
};

/** A basic set of GNU system utilites. */
export const env = async (arg?: tg.Unresolved<Arg>) => {
	const {
		build,
		env: env_,
		host: host_,
		sdk,
	} = arg ? await tg.resolve(arg) : {};
	const host = host_ ?? (await std.triple.host());

	const shellArtifact = await bash.build({ build, env: env_, host, sdk });
	const shellExecutable = await shellArtifact
		.get(`bin/bash`)
		.then(tg.File.expect);
	const shellEnv = {
		CONFIG_SHELL: shellExecutable,
		SHELL: shellExecutable,
	};
	const env = await std.env.arg(env_, shellEnv);

	let utils = [shellArtifact, shellEnv];
	utils = utils.concat(
		await Promise.all([
			bzip2({ build, env, host, sdk }),
			coreutils({ build, env, host, sdk }),
			diffutils({ build, env, host, sdk }),
			findutils({ build, env, host, sdk }),
			gawk({ build, env, host, sdk }),
			grep({ build, env, host, sdk }),
			gzip({ build, env, host, sdk }),
			make({ build, env, host, sdk }),
			patch({ build, env, host, sdk }),
			sed({ build, env, host, sdk }),
			tar({ build, env, host, sdk }),
			xz({ build, env, host, sdk }),
		]),
	);
	return await std.env.arg(...utils);
};

export default env;

/** All utils builds must begin with these prerequisites in the build environment, which include patched `cp` and `install` commands that always preseve extended attributes.*/
export const prerequisites = async (hostArg?: tg.Unresolved<string>) => {
	const host = hostArg ? await tg.resolve(hostArg) : await std.triple.host();
	const components: Array<tg.Unresolved<std.env.Arg>> = [bootstrap.utils(host)];

	// Add GNU make.
	const makeArtifact = await bootstrap.make.build({ host });
	components.push(makeArtifact);

	// Add patched GNU coreutils.
	const coreutilsArtifact = await coreutils({
		env: std.env.arg(bootstrap.sdk(), makeArtifact),
		host,
		sdk: false,
		usePrerequisites: false,
	});
	components.push(coreutilsArtifact);

	return std.env.arg(...components);
};

export type BuildUtilArg = std.autotools.Arg & {
	/** Wrap the scripts in the output at the specified paths with bash as the interpreter. */
	wrapBashScriptPaths?: Array<string> | undefined;
};

/** Build a util. This wraps std.phases.autotools.build(), adding the wrapBashScriptPaths post-process step and -Os optimization flag, and disabling extra tools. */
export const autotoolsInternal = async (arg: tg.Unresolved<BuildUtilArg>) => {
	const {
		extended = false,
		pkgConfig = false,
		opt = "s",
		wrapBashScriptPaths,
		...rest
	} = await tg.resolve(arg);
	let output = await std.autotools.build({
		...rest,
		extended,
		pkgConfig,
		opt,
	});
	for (const path of wrapBashScriptPaths ?? []) {
		const file = tg.File.expect(await output.get(path));
		const wrappedFile = changeShebang(file);
		output = await tg.directory(output, {
			[path]: wrappedFile,
		});
	}
	return output;
};

/** Given a file containing a shell script, change the given shebang to use /usr/bin/env.  The SDK will place bash on the path.  */
export const changeShebang = async (scriptFile: tg.File) => {
	// Ensure the file has a shebang.
	const metadata = await std.file.executableMetadata(scriptFile);
	tg.assert(metadata.format === "shebang");

	// Replace the first line with a new shebang.
	const fileContents = await scriptFile.text();
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
};

export const assertProvides = async (env: std.env.Arg) => {
	const names = [
		"bash", // bash for linux, zsh for macOS
		"bzip2",
		"ls", // coreutils
		"diff", // diffutils
		"find", // findutils
		"gawk",
		"grep",
		"gzip",
		"make",
		"patch",
		"sed",
		"tar",
		"xz",
	];
	await std.env.assertProvides({ env, names });
	return true;
};

export const test = async () => {
	const host = bootstrap.toolchainTriple(await std.triple.host());
	const utilsEnv = await env({ host, sdk: false, env: bootstrap.sdk() });
	await assertProvides(utilsEnv);
	return utilsEnv;
};

export const testPrerequisites = async () => {
	const host = bootstrap.toolchainTriple(await std.triple.host());
	return await prerequisites(host);
};
