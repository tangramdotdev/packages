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
export const env = tg.target(async (arg?: Arg) => {
	const { env: env_, host: host_, ...rest } = arg ?? {};
	const host = host_ ?? (await std.triple.host());

	// Build bash and use it as the default shell.
	const bashArtifact = await bash.build({
		...rest,
		env: env_,
		host,
	});

	const bashExecutable = tg.File.expect(await bashArtifact.get("bin/bash"));
	const bashEnv = {
		CONFIG_SHELL: bashExecutable,
		SHELL: bashExecutable,
	};
	const env = await std.env.arg(env_, bashEnv);

	let utils = [bashArtifact, bashEnv];
	utils = utils.concat(
		await Promise.all([
			bzip2({ ...rest, env, host }),
			coreutils({ ...rest, env, host }),
			diffutils({ ...rest, env, host }),
			findutils({ ...rest, env, host }),
			gawk({ ...rest, env, host }),
			grep({ ...rest, env, host }),
			gzip({ ...rest, env, host }),
			make({ ...rest, env, host }),
			patch({ ...rest, env, host }),
			sed({ ...rest, env, host }),
			tar({ ...rest, env, host }),
			xz({ ...rest, env, host }),
		]),
	);
	return await std.env.arg(utils);
});

export default env;

/** All utils builds must begin with these prerequisites in the build environment, which include patched `cp` and `install` commands that always preseve extended attributes.*/
export const prerequisites = tg.target(async (hostArg?: string) => {
	const host = hostArg ?? (await std.triple.host());
	const components: std.Args<std.env.Arg> = [await bootstrap.utils(host)];

	// Add GNU make.
	const makeArtifact = await bootstrap.make.build(host);
	components.push(makeArtifact);

	// Add patched GNU coreutils.
	const coreutilsArtifact = await coreutils({
		env: std.env.arg(bootstrap.sdk(), makeArtifact),
		host,
		sdk: false,
		usePrerequisites: false,
	});
	components.push(coreutilsArtifact);

	return components;
});

type BuildUtilArg = std.autotools.Arg & {
	/** Wrap the scripts in the output at the specified paths with bash as the interpreter. */
	wrapBashScriptPaths?: Array<string> | undefined;
};

/** Build a util. This wraps std.phases.autotools.build(), adding the wrapBashScriptPaths post-process step and -Os optimization flag. */
export const buildUtil = tg.target(async (arg: BuildUtilArg) => {
	const { opt: opt_, wrapBashScriptPaths, ...rest } = arg;
	const opt = opt_ ?? "s";
	let output = await std.autotools.build({
		...rest,
		opt,
	});

	// Wrap the bash scripts in the output.
	for (const path of arg.wrapBashScriptPaths ?? []) {
		const file = tg.File.expect(await output.get(path));
		const wrappedFile = changeShebang(file);
		output = await tg.directory(output, {
			[path]: wrappedFile,
		});
	}

	return output;
});

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
		"bash",
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

export const test = tg.target(async () => {
	const host = bootstrap.toolchainTriple(await std.triple.host());
	const utilsEnv = await env({ host, sdk: false, env: bootstrap.sdk() });
	await assertProvides(utilsEnv);
	return utilsEnv;
});
