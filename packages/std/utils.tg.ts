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

type Arg = std.sdk.BuildEnvArg & {
	parallel?: boolean;
};

/** A basic set of GNU system utilites. */
export let env = tg.target(async (arg?: Arg) => {
	let {
		bootstrapMode: bootstrapMode_,
		env: env_,
		host: host_,
		parallel: parallel_,
		...rest
	} = arg ?? {};
	let host = host_ ? std.triple(host_) : await std.Triple.host();
	let bootstrapMode = bootstrapMode_ ?? false;

	// On macOS, temporarily build in series.
	let parallel = parallel_ ?? host.os !== "darwin";

	if (bootstrapMode) {
		await prerequisites({ host });
	}

	// Build bash and use it as the default shell.
	let bashArtifact = await bash.build({
		...rest,
		bootstrapMode,
		env: env_,
		host,
	});
	let bashExecutable = tg.File.expect(await bashArtifact.get("bin/bash"));
	let env = [
		{
			CONFIG_SHELL: bashExecutable,
			SHELL: bashExecutable,
		},
		env_,
	];

	let utils = [bashArtifact];
	if (parallel) {
		utils = utils.concat(
			await Promise.all([
				coreutils({ ...rest, bootstrapMode, env, host }),
				diffutils({ ...rest, bootstrapMode, env, host }),
				findutils({ ...rest, bootstrapMode, env, host }),
				gawk({ ...rest, bootstrapMode, env, host }),
				grep({ ...rest, bootstrapMode, env, host }),
				gzip({ ...rest, bootstrapMode, env, host }),
				sed({ ...rest, bootstrapMode, env, host }),
				tar({ ...rest, bootstrapMode, env, host }),
			]),
		);
	} else {
		utils.push(await coreutils({ ...rest, bootstrapMode, env, host }));
		utils.push(await diffutils({ ...rest, bootstrapMode, env, host }));
		utils.push(await findutils({ ...rest, bootstrapMode, env, host }));
		utils.push(await gawk({ ...rest, bootstrapMode, env, host }));
		utils.push(await grep({ ...rest, bootstrapMode, env, host }));
		utils.push(await gzip({ ...rest, bootstrapMode, env, host }));
		utils.push(await sed({ ...rest, bootstrapMode, env, host }));
		utils.push(await tar({ ...rest, bootstrapMode, env, host }));
	}

	return std.env(...utils, env, { bootstrapMode: true });
});

export default env;

/** All utils builds must begin with these prerequisites in the build environment, which include patched `cp` and `install` commands that always preseve extended attributes.*/
export let prerequisites = tg.target(async (arg?: std.Triple.HostArg) => {
	let host = await std.Triple.host(arg);
	let components: tg.Unresolved<std.env.Arg> = [];

	// Add GNU make.
	let makeArtifact = await bootstrap.make.build({ host });
	components.push(makeArtifact);

	// Add patched GNU coreutils.
	let bootstrapMode = true;
	let coreutilsArtifact = await coreutils({
		env: [std.sdk({ host, bootstrapMode }), makeArtifact],
		host,
		bootstrapMode,
		usePrerequisites: false,
	});
	components.push(coreutilsArtifact);

	// On Linux, build musl and use it for the runtime libc.
	if (host.os === "linux" && host.environment === "musl") {
		let muslEnv = await muslRuntimeEnv(host);
		components.push(muslEnv);
	}

	return std.env(...components, { bootstrapMode: true });
});

/** Build a fresh musl and use it as the runtime libc. */
export let muslRuntimeEnv = async (arg?: std.Triple.HostArg) => {
	let host = await std.Triple.host(arg);
	if (host.os !== "linux") {
		throw new Error("muslRuntimeEnv is only supported on Linux.");
	}
	let muslArtifact = await bootstrap.musl.build({ host });
	let interpreter = tg.File.expect(
		await muslArtifact.get(bootstrap.musl.interpreterPath(host)),
	);
	return std.env(
		muslArtifact,
		{
			TANGRAM_LINKER_INTERPRETER_PATH: interpreter,
		},
		{ bootstrapMode: true },
	);
};

type BuildUtilArg = std.autotools.Arg & {
	/** Wrap the scripts in the output at the specified paths with bash as the interpreter. */
	wrapBashScriptPaths?: Array<string>;
};

/** Build a util. This wraps std.phases.autotools.build(), adding the wrapBashScriptPaths post-process step and -Os optimization flag. */
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
	let host = bootstrap.toolchainTriple(await std.Triple.host());
	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });
	let utilsEnv = await env({ host, bootstrapMode, env: sdk });
	await assertProvides(utilsEnv);
	return true;
});
