import * as std from "./tangram.ts";
import * as bootstrap from "./bootstrap.tg.ts";
import {
	buildDefaultBash,
	defaultCommandArg,
	defaultTemplateCommandArg,
	linuxRootMount,
} from "./command.tg.ts";

export function run(...args: tg.Args<tg.Process.RunArg>): RunBuilder;
export function run(
	strings: TemplateStringsArray,
	...placeholders: tg.Args<tg.Template.Arg>
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
	env?: std.env.Arg | Array<std.env.Arg> | undefined;
	executable?: tg.Command.ExecutableArg | undefined;
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
	#args: tg.Args<RunArgObject>;
	#defaultShellFallback: boolean;
	#defaultMount: boolean;
	#disallowUnset: boolean;
	#exitOnErr: boolean;
	#includeUtils: boolean;
	#pipefail: boolean;

	constructor(...args: tg.Args<RunArgObject>) {
		this.#args = args;
		this.#defaultMount = true;
		this.#defaultShellFallback = true;
		this.#disallowUnset = true;
		this.#exitOnErr = true;
		this.#includeUtils = true;
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
		executable: tg.Unresolved<tg.MaybeMutation<tg.Command.ExecutableArg>>,
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

	network(network: tg.Unresolved<tg.MaybeMutation<boolean>>): this {
		this.#args.push({ network });
		return this;
	}

	pipefail(b: boolean): this {
		this.#pipefail = b;
		return this;
	}

	async mergeArgs(): Promise<RunArgObject> {
		let resolved = await Promise.all(this.#args.map(tg.resolve));
		let objects = await Promise.all(
			resolved.map(async (arg) => {
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
						host: await tg.process.env("TANGRAM_HOST"),
					};
				} else if (arg instanceof tg.Command) {
					let object = await arg.object();
					let ret: RunArgObject = {
						args: object.args,
						env: [object.env as std.env.EnvObject],
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
					return { ...arg, env: [arg.env] } as RunArgObject;
				}
			}),
		);
		let arg = await tg.Args.apply(objects, {
			args: "append",
			env: "append",
		});
		return arg;
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
		let arg = await this.mergeArgs();
		let envs: Array<tg.Unresolved<std.env.Arg>> = [];
		let tangramHost = await std.triple.host();
		if (arg.host === undefined) {
			arg.host = tangramHost;
		}
		if (this.#includeUtils) {
			envs.push(await tg.build(std.utils.env, { host: arg.host }));
		}
		if (Array.isArray(arg.env)) {
			envs.push(...arg.env);
		} else {
			envs.push(arg.env);
		}
		arg.env = await std.env.arg(...envs);
		const shellVal = await std.env.tryGetShellExecutable(arg.env);
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
			const linuxMount = await tg.build(linuxRootMount, arg.host);
			if (arg.mounts === undefined) {
				arg.mounts = [linuxMount];
			} else {
				arg.mounts.unshift(linuxMount);
			}
		}
		return tg.run(arg as tg.Process.RunArgObject).then(onfulfilled, onrejected);
	}
}

export const testDollar = async () => {
	const f = tg.file("hello there!!!\n");
	const output = await $`cat ${f} > $OUTPUT
		echo $NAME >> $OUTPUT
		echo $TOOL >> $OUTPUT`
		.env({ NAME: "ben" })
		.env({ TOOL: "tangram" })
		.env({ NAME: tg.Mutation.suffix("L.", " ") })
		.then(tg.File.expect);
	const actual = await output.text();
	const expected = "hello there!!!\nben L.\ntangram\n";
	tg.assert(actual === expected, `expected ${actual} to equal ${expected}`);
	return true;
};

export const testDollarBootstrap = async () => {
	const f = tg.file("hello there!!!\n");
	const utils = bootstrap.utils();
	const output = await $`cat ${f} > $OUTPUT
		echo $NAME >> $OUTPUT
		echo $TOOL >> $OUTPUT`
		.bootstrap(true)
		.env({ NAME: "ben" })
		.env({ TOOL: "tangram" })
		.env({ NAME: tg.Mutation.suffix("L.", " ") })
		.env(utils)
		.then(tg.File.expect);
	const actual = await output.text();
	const expected = "hello there!!!\nben L.\ntangram\n";
	tg.assert(actual === expected, `expected ${actual} to equal ${expected}`);
	return true;
};

export const testEnvClear = async () => {
	const output = await $`/usr/bin/env > $OUTPUT`
		.bootstrap(true)
		.env({ FOO: "foo!" })
		.env({ BAR: "bar!" })
		.env(tg.Mutation.set({ BAZ: "baz!" }))
		.then(tg.File.expect);
	const actual = await output.text();
	console.log("actual", actual);
	tg.assert(actual.includes("baz!"), "expected output to contain `baz!`");
	tg.assert(!actual.includes("foo!"), "expected output to not contain `foo!`");
	return true;
};
