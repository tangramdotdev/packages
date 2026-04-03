import * as std from "./tangram.ts";

export function command(...args: std.Args<tg.Command.Arg>): tg.Command.Builder;
export function command(
	strings: TemplateStringsArray,
	...placeholders: std.Args<tg.Template.Arg>
): tg.Command.Builder;
export function command(...args: any): any {
	if (Array.isArray(args[0]) && "raw" in args[0]) {
		const strings = args[0] as TemplateStringsArray;
		const placeholders = args.slice(1);
		return tg.command(stdCommandArg(strings, ...placeholders));
	} else {
		return tg.command(defaultEnvArg(), ...args);
	}
}

/** Resolve std shell and env for a command template literal. */
const stdCommandArg = async (
	strings: TemplateStringsArray,
	...placeholders: std.Args<tg.Template.Arg>
) => {
	const host = std.triple.host();
	const env = await tg
		.build(std.utils.env, { host, env: std.sdk() })
		.named("utils");
	const shell = await buildDefaultBash(host);
	return {
		executable: shell,
		args: [
			"-e",
			"-u",
			"-o",
			"pipefail",
			"-c",
			tg.template(strings, ...placeholders),
		],
		env,
		host,
	};
};

/** The internal arg type shared by process wrappers. */
export type ProcessArgObject = {
	args?: Array<tg.Value> | undefined;
	checksum?: tg.Checksum | undefined;
	cwd?: string | undefined;
	env?: std.env.Arg;
	executable?: tg.Command.Arg.Executable | undefined;
	host?: string | undefined;
	name?: string | undefined;
	network?: boolean | undefined;
	sandbox?: boolean | tg.Sandbox.Arg | tg.Sandbox.Id | undefined;
	stdin?: tg.Blob.Arg | undefined;
	user?: string | undefined;
};

/** Merge an array of ProcessArgObjects into a single one. */
export const mergeArgs = async (
	...args: std.Args<ProcessArgObject>
): Promise<ProcessArgObject> => {
	return await std.args.apply<ProcessArgObject, ProcessArgObject>({
		args,
		map: async (arg) => {
			if (arg === undefined) {
				return {};
			} else if (
				typeof arg === "string" ||
				tg.Artifact.is(arg) ||
				arg instanceof tg.Template
			) {
				return {
					args: ["-c", arg],
					executable: "/bin/sh",
					host: tg.process.env.TANGRAM_HOST as string,
				};
			} else if (arg instanceof tg.Command) {
				const obj = await arg.object();
				return {
					args: obj.args,
					env: obj.env as std.env.EnvObject,
					executable: obj.executable,
					host: obj.host,
					...(obj.cwd !== undefined && { cwd: obj.cwd }),
					...(obj.stdin !== undefined && { stdin: obj.stdin }),
					...(obj.user !== undefined && { user: obj.user }),
				};
			} else {
				return { ...arg, env: arg.env };
			}
		},
		reduce: {
			args: "append",
			env: (a, b) => std.env.arg(a, b, { utils: false }),
		},
	});
};

/** Provide a default env arg with utils and SDK for non-template overloads. */
export const defaultEnvArg = async (hostArg?: tg.Unresolved<string>) => {
	const host = hostArg ? await tg.resolve(hostArg) : std.triple.host();
	const defaultEnv = await tg
		.build(std.utils.env, { host, env: std.sdk() })
		.named("utils");
	return { env: defaultEnv };
};

/** Build the default shell, returning the file directly. */
export const buildDefaultBash = async (hostArg?: tg.Unresolved<string>) => {
	const host = hostArg ? await tg.resolve(hostArg) : std.triple.host();
	return await tg
		.build(std.utils.bash.build, { host })
		.named("bash")
		.then((dir) => dir.get("bin/bash"))
		.then(tg.File.expect);
};

export const test = async () => {
	await testCommandNonTemplateString();
	await testCommandNonTemplateArtifact();
	await testCommandNonTemplateEnv();
	return true;
};

/** Test the non-template `command` overload with a string executable path. */
export const testCommandNonTemplateString = async () => {
	const cmd = await command({
		executable: "/bin/sh",
		args: ["-c", tg`echo "hello" > ${tg.output}`],
	});
	const output = await tg.run(cmd).then(tg.File.expect);
	const actual = await output.text;
	const expected = "hello\n";
	tg.assert(actual === expected, `expected ${expected} but got ${actual}`);
	return true;
};

/** Test the non-template `command` overload with an artifact executable. */
export const testCommandNonTemplateArtifact = async () => {
	const bashDir = await std.utils.bash.build({ env: std.sdk() });
	const bashExe = await bashDir.get("bin/bash").then(tg.File.expect);
	const cmd = await command({
		executable: bashExe,
		args: ["-c", tg`echo "artifact" > ${tg.output}`],
	});
	const output = await tg.run(cmd).then(tg.File.expect);
	const actual = await output.text;
	const expected = "artifact\n";
	tg.assert(actual === expected, `expected ${expected} but got ${actual}`);
	return true;
};

/** Test the non-template `command` overload with an env containing an SDK. */
export const testCommandNonTemplateEnv = async () => {
	const env = await std.env.arg(std.sdk());
	const cmd = await command({
		executable: "/bin/sh",
		args: ["-c", tg`cc --version > ${tg.output}`],
		env,
	});
	const output = await tg.run(cmd).then(tg.File.expect);
	const actual = await output.text;
	tg.assert(actual.length > 0, "expected non-empty compiler version output");
	return true;
};
