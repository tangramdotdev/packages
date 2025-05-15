import * as std from "./tangram.ts";
import {
	buildDefaultBash,
	defaultCommandArg,
	defaultTemplateCommandArg,
	linuxRootMount,
} from "./command.tg.ts";

export function build(...args: std.Args<tg.Process.BuildArg>): BuildBuilder;
export function build(
	strings: TemplateStringsArray,
	...placeholders: std.Args<tg.Template.Arg>
): BuildBuilder;
export function build(...args: any): any {
	if (Array.isArray(args[0]) && "raw" in args[0]) {
		const strings = args[0] as TemplateStringsArray;
		const placeholders = args.slice(1);
		const arg = defaultTemplateCommandArg(strings, ...placeholders);
		return new BuildBuilder(arg);
	} else {
		return tg.build(defaultCommandArg(), ...args);
	}
}

type BuildArgObject = {
	args?: Array<tg.Value> | undefined;
	checksum?: tg.Checksum | undefined;
	cwd?: string | undefined;
	env?: std.env.Arg;
	executable?: tg.Command.ExecutableArg | undefined;
	host?: string | undefined;
	mounts?: Array<string | tg.Template | tg.Command.Mount> | undefined;
	network?: boolean | undefined;
	stdin?: tg.Blob.Arg | undefined;
	user?: string | undefined;
};

export interface BuildBuilder<
	A extends Array<tg.Value> = Array<tg.Value>,
	R extends tg.Value = tg.Value,
> {
	(...args: { [K in keyof A]: tg.Unresolved<A[K]> }): BuildBuilder<[], R>;
}

export class BuildBuilder<
	A extends Array<tg.Value> = Array<tg.Value>,
	R extends tg.Value = tg.Value,
> {
	#args: std.Args<BuildArgObject>;
	#defaultShellFallback: boolean;
	#defaultMount: boolean;
	#disallowUnset: boolean;
	#exitOnErr: boolean;
	#includeUtils: boolean;
	#pipefail: boolean;

	constructor(...args: std.Args<BuildArgObject>) {
		this.#args = args;
		this.#defaultMount = true;
		this.#defaultShellFallback = true;
		this.#disallowUnset = true;
		this.#exitOnErr = true;
		this.#includeUtils = true;
		this.#pipefail = true;
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

	disallowUnset(b: boolean): this {
		this.#disallowUnset = b;
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

	mount(
		...mounts: Array<tg.Unresolved<string | tg.Template | tg.Command.Mount>>
	): this {
		this.#args.push({ mounts });
		return this;
	}

	mounts(
		...mounts: Array<
			tg.Unresolved<
				tg.MaybeMutation<Array<string | tg.Template | tg.Command.Mount>>
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
		let envs: Array<tg.Unresolved<std.env.Arg>> = [];
		let tangramHost = await std.triple.host();
		if (arg.host === undefined) {
			arg.host = tangramHost;
		}
		if (!this.#includeUtils) {
			envs.push({ utils: false });
		}
		envs.push(arg.env);
		arg.env = await std.env.arg(...envs);
		const shellVal = await std.env.tryGetShellExecutable(
			arg.env as std.env.EnvObject,
		);
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
		return tg
			.build(arg as tg.Process.BuildArgObject)
			.then(onfulfilled, onrejected);
	}
}

export const mergeArgs = async (
	...args: std.Args<BuildArgObject>
): Promise<BuildArgObject> => {
	return await std.args.apply<BuildArgObject, BuildArgObject>({
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
					host: (await tg.process.env("TANGRAM_HOST")) as string,
				};
			} else if (arg instanceof tg.Command) {
				let object = await arg.object();
				let ret: BuildArgObject = {
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

export const testBuild = async () => {
	const expected = await tg.process.env("TANGRAM_HOST");
	const output = await std.build`echo $TANGRAM_HOST > $OUTPUT`.then(
		tg.File.expect,
	);
	const actual = (await output.text()).trim();
	tg.assert(actual === expected, `expected ${actual} to equal ${expected}`);
	return true;
};

export const testBuildBootstrap = async () => {
	const expected = await tg.process.env("TANGRAM_HOST");
	const output = await std.build`echo $TANGRAM_HOST > $OUTPUT`
		.includeUtils(false)
		.pipefail(false)
		.env({ SHELL: "/bin/sh" })
		.then(tg.File.expect);
	const actual = (await output.text()).trim();
	tg.assert(actual === expected, `expected ${actual} to equal ${expected}`);
	return true;
};
