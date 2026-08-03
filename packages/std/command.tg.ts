import * as std from "./tangram.ts";
import { envObjectFromArtifact } from "./env.tg.ts";

/** Widen a tg builder's env to accept `std.env.Arg`. Each argument is mapped independently, then `tg.Command.Arg.Env.reduce` merges the results. This is the only behavior std adds to `tg.Command.Arg.Env`. */
export const envMapper = async (
	arg: std.env.Arg,
): Promise<tg.Command.Arg.Env> => {
	if (arg === undefined || arg === null) {
		return {};
	} else if (arg instanceof tg.Mutation) {
		// tg applies a top-level mutation during arg reduction.
		return arg as unknown as tg.Command.Arg.Env;
	} else if (arg instanceof tg.Command) {
		const artifact = await tg.build(arg);
		tg.Artifact.assert(artifact);
		return envObject(await envObjectFromArtifact(artifact));
	} else if (tg.Artifact.is(arg)) {
		return envObject(await envObjectFromArtifact(arg));
	} else {
		return envObject(arg);
	}
};

/** Coerce the booleans and numbers `std.env.ArgObject` permits into strings. */
const envObject = (arg: std.env.ArgObject): tg.Command.Arg.Env =>
	Object.fromEntries(
		Object.entries(arg).flatMap(([key, value]) => {
			if (value === undefined) {
				return [];
			}
			const coerced =
				typeof value === "boolean" || typeof value === "number"
					? String(value)
					: value;
			return [[key, coerced as tg.Command.Arg.Value | tg.Mutation]];
		}),
	);

/** The shared std utils env, identical to the env `std.env.arg` appends and to the one used elsewhere in the codebase, so it is never rebuilt. */
export const stdEnv = async (): Promise<std.env.EnvObject> =>
	await std.env.defaultUtils();

/** The directory providing the std shell, taken from the shared default env. Placing this on `PATH` provides a wrapped `sh` and `bash` without the rest of the utils. */
export const defaultShellDir = async (): Promise<tg.Directory> => {
	const dir = await std.env.whichArtifact({
		env: await stdEnv(),
		name: "bash",
	});
	tg.assert(dir !== undefined, "the default env does not provide bash");
	return dir;
};

/** The std shell. Derived from `defaultShellDir` so the executable and the `PATH` entry are one artifact rather than two separate builds. */
export const defaultBash = async (): Promise<tg.File> =>
	await defaultShellDir()
		.then((dir) => dir.get("bin/bash"))
		.then(tg.File.expect);

/** Which utils the shell places on `PATH`. `"shell"` provides only a wrapped `sh` and `bash`, for scripts that invoke a nested shell but get everything else from their own env. */
export type ShUtils = "std" | "bootstrap" | "shell" | "none";

/** Options for std's shell. Each was previously a method on the process builder. */
export type ShArg = {
	/** Use raw `/bin/sh` rather than the std bash. Implies `pipefail: false`, and defaults `utils` to `"bootstrap"`. */
	bootstrap?: boolean;
	/** Start in a per-process work subdir so `$(pwd)` is not "/". Defaults to `true`. */
	cd?: boolean;
	/** The `-u` shell flag. Defaults to `true`. */
	disallowUnset?: boolean;
	/** The `-e` shell flag. Defaults to `true`. */
	exitOnErr?: boolean;
	/** The `-o pipefail` shell flag. Defaults to `true`, or to `false` under `bootstrap`, since dash lacks it. */
	pipefail?: boolean;
	/** Which utils to place on `PATH`. Defaults to `"bootstrap"` under `bootstrap`, otherwise `"std"`. */
	utils?: ShUtils;
};

const isTemplate = (arg: unknown): arg is TemplateStringsArray =>
	Array.isArray(arg) && "raw" in arg;

/** std's shell as a plain command arg. Call it as a tagged template for the defaults, or pass a `ShArg` to get a tagged template with those options applied. */
export function sh(
	strings: TemplateStringsArray,
	...placeholders: tg.Args<tg.Template.Arg>
): Promise<tg.Command.Arg.Object>;
export function sh(
	arg: ShArg,
): (
	strings: TemplateStringsArray,
	...placeholders: tg.Args<tg.Template.Arg>
) => Promise<tg.Command.Arg.Object>;
export function sh(...args: any): any {
	if (isTemplate(args[0])) {
		return shArg({}, args[0], ...args.slice(1));
	}
	const arg = args[0] as ShArg;
	return (
		strings: TemplateStringsArray,
		...placeholders: tg.Args<tg.Template.Arg>
	) => shArg(arg, strings, ...placeholders);
}

const shArg = async (
	arg: ShArg,
	strings: TemplateStringsArray,
	...placeholders: tg.Args<tg.Template.Arg>
): Promise<tg.Command.Arg.Object> => {
	const {
		bootstrap = false,
		cd = true,
		disallowUnset = true,
		exitOnErr = true,
		pipefail = !bootstrap,
		utils = bootstrap ? "bootstrap" : "std",
	} = arg;
	const host = std.triple.host();
	const flags: Array<string> = [];
	if (exitOnErr) {
		flags.push("-e");
	}
	if (disallowUnset) {
		flags.push("-u");
	}
	if (pipefail) {
		flags.push("-o", "pipefail");
	}
	let template = await tg.template(strings, ...placeholders);
	if (cd) {
		template = await tg.template`cd "$(mktemp -d)"\n${template}`;
	}
	let env: tg.Command.Arg.Env = {};
	if (utils === "std") {
		env = await envMapper(await stdEnv());
	} else if (utils === "bootstrap") {
		env = await envMapper(await std.bootstrap.utils(host));
	} else if (utils === "shell") {
		env = await envMapper(await defaultShellDir());
	}
	return {
		args: [...flags, "-c", template],
		env,
		executable: bootstrap ? "/bin/sh" : await defaultBash(),
		host,
	};
};

/** std's bootstrap shell: raw `/bin/sh` with the bootstrap utils and no pipefail. */
export const shBootstrap = sh({ bootstrap: true });

/** Run the tagged-template form under std's shell, which carries the std env. Every other form passes through to tg untouched, so a bootstrap build never evaluates `stdEnv`. */
export const stdArgs = (args: Array<any>): Array<any> =>
	isTemplate(args[0]) ? [sh(args[0], ...args.slice(1))] : args;

/** A `tg.Command.Builder` whose env accepts `std.env.Arg`. */
export type CommandBuilder<
	A extends Array<tg.Value> = Array<tg.Value>,
	O extends tg.Value = tg.Value,
> = tg.Command.Builder<A, O, std.env.Arg>;

/** The overloads of `tg.command`, with the env widened to `std.env.Arg`. */
export type CommandBuilderFactory = {
	<A extends tg.UnresolvedArgs<Array<tg.Value>>, O extends tg.ReturnValue>(
		function_: (...args: A) => O,
	): CommandBuilder<[], tg.ResolvedReturnValue<O>>;
	<A extends tg.UnresolvedArgs<Array<tg.Value>>, O extends tg.ReturnValue>(
		function_: (...args: A) => O,
		...args: tg.UnresolvedArgs<tg.ResolvedArgs<A>>
	): CommandBuilder<[], tg.ResolvedReturnValue<O>>;
	(
		strings: TemplateStringsArray,
		...placeholders: tg.Args<tg.Template.Arg>
	): CommandBuilder;
	(...args: tg.Args<tg.Command.Arg>): CommandBuilder;
};

/** `tg.command` plus the std env and the env mapper. */
export const command: CommandBuilderFactory = (...args: any): any =>
	tg.command(...stdArgs(args)).envMapper(envMapper);

export async function test() {
	await testCommandArgs();
	await testCommandTemplate();
	await testCommandEnvArtifact();
	return true;
}

/** Test the arg form, which passes through to tg untouched. */
export async function testCommandArgs() {
	const cmd = await command({
		executable: "/bin/sh",
		args: ["-c", tg`echo "hello" > ${tg.output}`],
	});
	const output = await tg.run(cmd).then(tg.File.expect);
	const actual = await output.text;
	const expected = "hello\n";
	tg.assert(actual === expected, `expected ${expected} but got ${actual}`);
	return true;
}

/** Test the template form, which runs under std's shell. */
export async function testCommandTemplate() {
	const cmd = await command`echo "template" > ${tg.output}`;
	const output = await tg.run(cmd).then(tg.File.expect);
	const actual = await output.text;
	const expected = "template\n";
	tg.assert(actual === expected, `expected ${expected} but got ${actual}`);
	return true;
}

/** Test that the env mapper accepts an artifact directly, which tg's env does not. */
export async function testCommandEnvArtifact() {
	const cmd = await command`cc --version > ${tg.output}`.env(std.sdk());
	const output = await tg.run(cmd).then(tg.File.expect);
	const actual = await output.text;
	tg.assert(actual.length > 0, "expected non-empty compiler version output");
	return true;
}
