import * as bootstrap from "./bootstrap.tg.ts";
import * as std from "./tangram.tg.ts";
import * as bash from "./utils/bash.tg.ts";
import coreutils from "./utils/coreutils.tg.ts";
import diffutils from "./utils/diffutils.tg.ts";
import findutils from "./utils/findutils.tg.ts";
import gawk from "./utils/gawk.tg.ts";
import grep from "./utils/grep.tg.ts";
import gzip from "./utils/gzip.tg.ts";
import sed from "./utils/sed.tg.ts";
import tar from "./utils/tar.tg.ts";

export * as attr from "./utils/attr.tg.ts";
export * as bash from "./utils/bash.tg.ts";
export * as coreutils from "./utils/coreutils.tg.ts";
export * as diffutils from "./utils/diffutils.tg.ts";
export * as fileCmds from "./utils/file_cmds.tg.ts";
export * as findutils from "./utils/findutils.tg.ts";
export * as gawk from "./utils/gawk.tg.ts";
export * as grep from "./utils/grep.tg.ts";
export * as gzip from "./utils/gzip.tg.ts";
export * as libiconv from "./utils/libiconv.tg.ts";
export * as sed from "./utils/sed.tg.ts";
export * as tar from "./utils/tar.tg.ts";

/** A basic set of GNU system utilites. */
export let env = tg.target(async (arg?: std.sdk.BuildEnvArg) => {
	await bootstrap.make.build(arg);

	// Build bash and use it as the default shell.
	let bashAritfact = await bash.build(arg);
	let bashExecutable = tg.File.expect(await bashAritfact.get("bin/bash"));
	let env = {
		CONFIG_SHELL: bashExecutable,
		SHELL: bashExecutable,
	};
	let utils = await Promise.all([
		bashAritfact,
		coreutils({ ...arg, env }),
		diffutils({ ...arg, env }),
		findutils({ ...arg, env }),
		gawk({ ...arg, env }),
		grep({ ...arg, env }),
		gzip({ ...arg, env }),
		sed({ ...arg, env }),
		tar({ ...arg, env }),
	]);

	return std.env(...utils, env, { bootstrapMode: true });
});

export default env;

type BuildUtilArg = std.autotools.Arg & {
	/** Wrap the scripts in the output at the specified paths with bash as the interpreter. */
	wrapBashScriptPaths?: Array<string>;
};

/** Build a util. This wrapps std.phases.autotools.build(), adding the wrapBashScriptPaths post-process step and -Os optimization flag. */
export let buildUtil = tg.target(
	async (
		arg: BuildUtilArg,
		autotools: tg.MaybeNestedArray<std.autotools.Arg>,
	) => {
		let opt = arg.opt ?? "s";
		let output = await std.autotools.build(
			{
				...arg,
				opt,
			},
			autotools,
		);

		// Wrap the bash scripts in the output.
		for (let path of arg.wrapBashScriptPaths ?? []) {
			let file = tg.File.expect(await output.get(path));
			let wrappedFile = changeShebang(file);
			output = await tg.directory(output, {
				[path]: wrappedFile,
			});
		}

		return output;
	},
);

/** Given a file containing a shell script, change the given shebang to use /usr/bin/env.  The SDK will place bash on the path.  */
export let changeShebang = async (scriptFile: tg.File) => {
	// Ensure the file has a shebang.
	let metadata = await std.file.executableMetadata(scriptFile);
	tg.assert(metadata.format === "shebang");

	// Replace the first line with a new shebang.
	let fileContents = await scriptFile.text();
	let firstNewlineIndex = fileContents.indexOf("\n");
	if (firstNewlineIndex === -1) {
		return tg.unreachable(
			"Could not find newline in file contents, but we asserted it begins with a shebang.",
		);
	}
	let fileWithoutShebangLine = fileContents.substring(firstNewlineIndex + 1);
	let newFileContents = `#!/usr/bin/env bash\n${fileWithoutShebangLine}`;
	let newFile = tg.file({ contents: newFileContents, executable: true });
	return newFile;
};

export let assertProvides = async (env: std.env.Arg) => {
	let names = [
		"bash",
		"ls", // coreutils
		"diff", // diffutils
		"find", // findutils
		"gawk",
		"grep",
		"gzip",
		"sed",
		"tar",
	];
	await std.env.assertProvides({ env, names });
	return true;
};

export let test = tg.target(async () => {
	let utilsEnv = await env({ sdk: { bootstrapMode: true } });
	await assertProvides(utilsEnv);
	return true;
});
