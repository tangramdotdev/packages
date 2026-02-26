import * as std from "./tangram.ts";
import * as bootstrap from "./bootstrap.tg.ts";
import {
	buildDefaultBash,
	defaultCommandArg,
	defaultTemplateCommandArg,
	linuxRootMount,
} from "./command.tg.ts";

export function run(...args: std.Args<tg.Process.RunArg>): RunBuilder;
export function run(
	strings: TemplateStringsArray,
	...placeholders: std.Args<tg.Template.Arg>
): RunBuilder;
export function run(...args: any): any {
	if (Array.isArray(args[0]) && "raw" in args[0]) {
		const strings = args[0] as TemplateStringsArray;
		const placeholders = args.slice(1);
		const arg = defaultTemplateCommandArg(strings, ...placeholders);
		return new RunBuilder(arg);
	} else {
		return tg.run(defaultCommandArg(), ...args);
	}
}

export const $ = run;

type RunArgObject = {
	args?: Array<tg.Value> | undefined;
	checksum?: tg.Checksum | undefined;
	cwd?: string | undefined;
	env?: std.env.Arg;
	executable?: tg.Command.Arg.Executable | undefined;
	host?: string | undefined;
	mounts?:
		| Array<string | tg.Template | tg.Command.Mount | tg.Process.Mount>
		| undefined;
	network?: boolean | undefined;
	stderr?: undefined;
	stdin?: tg.Blob.Arg | undefined;
	stdout?: undefined;
	user?: string | undefined;
};

export class RunBuilder<
	A extends Array<tg.Value> = Array<tg.Value>,
	R extends tg.Value = tg.Value,
> {
	#args: std.Args<RunArgObject>;
	#defaultShellFallback: boolean;
	#defaultMount: boolean;
	#disallowUnset: boolean;
	#exitOnErr: boolean;
	#includeUtils: boolean;
	#name: tg.Unresolved<string | undefined> | undefined;
	#pipefail: boolean;

	constructor(...args: std.Args<RunArgObject>) {
		this.#args = args;
		this.#defaultMount = true;
		this.#defaultShellFallback = true;
		this.#disallowUnset = true;
		this.#exitOnErr = true;
		this.#includeUtils = true;
		this.#name = undefined;
		this.#pipefail = true;
	}

	allowUndefined(b: boolean): this {
		this.#disallowUnset = b;
		return this;
	}

	arg(...args: Array<tg.Unresolved<tg.Value>>): this {
		this.#args.push({ args });
		return this;
	}

	args(...args: Array<tg.Unresolved<tg.MaybeMutation<Array<tg.Value>>>>): this {
		this.#args.push(...args.map((args) => ({ args })));
		return this;
	}

	bootstrap(b: boolean): this {
		this.#includeUtils = !b;
		this.#pipefail = !b;
		this.#defaultShellFallback = !b;
		return this;
	}

	checksum(
		checksum: tg.Unresolved<tg.MaybeMutation<tg.Checksum | undefined>>,
	): this {
		this.#args.push({ checksum });
		return this;
	}

	cwd(cwd: tg.Unresolved<tg.MaybeMutation<string | undefined>>): this {
		this.#args.push({ cwd });
		return this;
	}

	defaultMount(b: boolean): this {
		this.#defaultMount = b;
		return this;
	}

	defaultShellFallback(b: boolean): this {
		this.#defaultShellFallback = b;
		return this;
	}

	env(...envs: Array<tg.Unresolved<tg.MaybeMutation<std.env.Arg>>>): this {
		this.#args.push(...envs.map((env) => ({ env })));
		return this;
	}

	executable(
		executable: tg.Unresolved<tg.MaybeMutation<tg.Command.Arg.Executable>>,
	): this {
		this.#args.push({ executable });
		return this;
	}

	exitOnErr(b: boolean): this {
		this.#exitOnErr = b;
		return this;
	}

	host(host: tg.Unresolved<tg.MaybeMutation<string>>): this {
		this.#args.push({ host });
		return this;
	}

	includeUtils(b: boolean): this {
		this.#includeUtils = b;
		return this;
	}

	mounts(
		...mounts: Array<
			tg.Unresolved<
				tg.MaybeMutation<
					Array<string | tg.Template | tg.Command.Mount | tg.Process.Mount>
				>
			>
		>
	): this {
		this.#args.push(...mounts.map((mounts) => ({ mounts })));
		return this;
	}

	named(name: tg.Unresolved<string | undefined>): this {
		this.#name = name;
		return this;
	}

	network(network: tg.Unresolved<tg.MaybeMutation<boolean>>): this {
		this.#args.push({ network });
		return this;
	}

	pipefail(b: boolean): this {
		this.#pipefail = b;
		return this;
	}

	async then<TResult1 = tg.Value, TResult2 = never>(
		onfulfilled?:
			| ((value: tg.Value) => TResult1 | PromiseLike<TResult1>)
			| undefined
			| null,
		onrejected?:
			| ((reason: any) => TResult2 | PromiseLike<TResult2>)
			| undefined
			| null,
	): Promise<TResult1 | TResult2> {
		let arg = await mergeArgs(...this.#args);
		let envs: std.Args<std.env.Arg> = [];
		let tangramHost = std.triple.host();
		if (arg.host === undefined) {
			arg.host = tangramHost;
		}
		if (!this.#includeUtils) {
			envs.push({ utils: false });
		}
		envs.push(arg.env);
		arg.env = await std.env.arg(...envs);
		let shellVal = await std.env.tryGetShellExecutable(
			arg.env as std.env.EnvObject,
		);
		if (shellVal instanceof tg.Symlink) {
			shellVal = await shellVal.resolve().then(tg.File.expect);
		}
		if (shellVal !== undefined) {
			arg.executable = shellVal;
		} else if (this.#defaultShellFallback) {
			arg.executable = await buildDefaultBash();
		}
		if (this.#pipefail) {
			if (arg.args === undefined) {
				arg.args = [];
			}
			arg.args.unshift("-o", "pipefail");
		}
		if (this.#disallowUnset) {
			if (arg.args === undefined) {
				arg.args = [];
			}
			arg.args.unshift("-u");
		}
		if (this.#exitOnErr) {
			if (arg.args === undefined) {
				arg.args = [];
			}
			arg.args.unshift("-e");
		}
		if (std.triple.os(arg.host) === "linux" && this.#defaultMount) {
			const linuxMount = await tg
				.build(linuxRootMount, arg.host)
				.named("linux root mount");
			if (arg.mounts === undefined) {
				arg.mounts = [linuxMount];
			} else {
				arg.mounts.unshift(linuxMount);
			}
		}
		let builder = tg.run(arg as tg.Process.RunArgObject);
		if (this.#name !== undefined) {
			builder = builder.named(this.#name);
		}
		return builder.then(onfulfilled, onrejected);
	}
}

export const mergeArgs = async (
	...args: std.Args<RunArgObject>
): Promise<RunArgObject> => {
	return await std.args.apply<RunArgObject, RunArgObject>({
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
				let object = await arg.object();
				let ret: RunArgObject = {
					args: object.args,
					env: object.env as std.env.EnvObject,
					executable: object.executable,
					host: object.host,
				};
				if (object.cwd !== undefined) {
					ret.cwd = object.cwd;
				}
				if (object.mounts !== undefined) {
					ret.mounts = object.mounts;
				}
				if (object.stdin !== undefined) {
					ret.stdin = object.stdin;
				}
				if (object.user !== undefined) {
					ret.user = object.user;
				}
				return ret;
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

export const testDollar = async () => {
	const f = tg.file`hello there!!!\n`;
	const output = await $`cat ${f} > ${tg.output}
		echo $NAME >> ${tg.output}
		echo $TOOL >> ${tg.output}`
		.env({ NAME: "ben" })
		.env({ TOOL: "tangram" })
		.env({ NAME: tg.Mutation.suffix("L.", " ") })
		.then(tg.File.expect);
	const actual = await output.text;
	const expected = "hello there!!!\nben L.\ntangram\n";
	tg.assert(actual === expected, `expected ${actual} to equal ${expected}`);
	return true;
};

export const testDollarBootstrap = async () => {
	const f = tg.file`hello there!!!\n`;
	const utils = bootstrap.sdk.prepareBootstrapUtils();
	const output = await $`cat ${f} > ${tg.output}
		echo $NAME >> ${tg.output}
		echo $TOOL >> ${tg.output}`
		.bootstrap(true)
		.env({ NAME: "ben" })
		.env({ TOOL: "tangram" })
		.env({ NAME: tg.Mutation.suffix("L.", " ") })
		.env(utils)
		.then(tg.File.expect);
	const actual = await output.text;
	const expected = "hello there!!!\nben L.\ntangram\n";
	tg.assert(actual === expected, `expected ${actual} to equal ${expected}`);
	return true;
};

export const test = async () => {
	await testDollar();
	await testDollarBootstrap();
	await testRunNonTemplateString();
	await testRunNonTemplateArtifact();
	await testRunNonTemplateEnv();
	await testEnvClear();
	return true;
};

/** Test the non-template `run` overload with a string executable path. */
export const testRunNonTemplateString = async () => {
	const output = await run({
		executable: "/bin/sh",
		args: ["-c", tg`echo "hello" > ${tg.output}`],
	}).then(tg.File.expect);
	const actual = await output.text;
	const expected = "hello\n";
	tg.assert(actual === expected, `expected ${expected} but got ${actual}`);
	return true;
};

/** Test the non-template `run` overload with an artifact executable. */
export const testRunNonTemplateArtifact = async () => {
	const bashDir = await std.utils.bash.build({ env: std.sdk() });
	const bashExe = await bashDir.get("bin/bash").then(tg.File.expect);
	const output = await run({
		executable: bashExe,
		args: ["-c", tg`echo "artifact" > ${tg.output}`],
	}).then(tg.File.expect);
	const actual = await output.text;
	const expected = "artifact\n";
	tg.assert(actual === expected, `expected ${expected} but got ${actual}`);
	return true;
};

/** Test the non-template `run` overload with an env containing an SDK. */
export const testRunNonTemplateEnv = async () => {
	const env = await std.env.arg(std.sdk());
	const output = await run({
		executable: "/bin/sh",
		args: ["-c", tg`cc --version > ${tg.output}`],
		env,
	}).then(tg.File.expect);
	const actual = await output.text;
	tg.assert(actual.length > 0, "expected non-empty compiler version output");
	return true;
};

export const testEnvClear = async () => {
	const output = await $`/usr/bin/env > ${tg.output}`
		.bootstrap(true)
		.env({ FOO: "foo!" })
		.env({ BAR: "bar!" })
		.env(tg.Mutation.set({ BAZ: "baz!" }))
		.then(tg.File.expect);
	const actual = await output.text;
	console.log("actual", actual);
	tg.assert(actual.includes("baz!"), "expected output to contain `baz!`");
	tg.assert(!actual.includes("foo!"), "expected output to not contain `foo!`");
	return true;
};
