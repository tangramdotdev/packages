import * as std from "./tangram.ts";
import * as bootstrap from "./bootstrap.tg.ts";

export function command<
	A extends Array<tg.Value> = Array<tg.Value>,
	R extends tg.Value = tg.Value,
>(...args: std.Args<tg.Command.Arg>): CommandBuilder;
export function command<
	A extends Array<tg.Value> = Array<tg.Value>,
	R extends tg.Value = tg.Value,
>(
	strings: TemplateStringsArray,
	...placeholders: std.Args<tg.Template.Arg>
): CommandBuilder<A, R>;
export function command(...args: any): any {
	if (Array.isArray(args[0]) && "raw" in args[0]) {
		let strings = args[0] as TemplateStringsArray;
		let placeholders = args.slice(1);
		let arg = defaultTemplateCommandArg(strings, ...placeholders);
		return new CommandBuilder(arg);
	} else {
		return tg.command(defaultCommandArg(), ...args);
	}
}

type CommandArgObject = {
	args?: Array<tg.Value> | undefined;
	cwd?: string | undefined;
	env?: std.env.Arg;
	executable?: tg.Command.Arg.Executable | undefined;
	host?: string | undefined;
	mounts?: Array<string | tg.Template | tg.Command.Mount> | undefined;
	stdin?: tg.Blob.Arg | undefined;
	user?: string | undefined;
};

export class CommandBuilder<
	A extends Array<tg.Value> = Array<tg.Value>,
	R extends tg.Value = tg.Value,
> {
	#args: std.Args<CommandArgObject>;
	#defaultMount: boolean;
	#defaultShellFallback: boolean;
	#disallowUnset: boolean;
	#exitOnErr: boolean;
	#includeUtils: boolean;
	#pipefail: boolean;

	constructor(...args: std.Args<CommandArgObject>) {
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
		executable: tg.Unresolved<tg.MaybeMutation<tg.Command.Executable>>,
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

	async then<TResult1 = tg.Command<A, R>, TResult2 = never>(
		onfulfilled?:
			| ((value: tg.Command<A, R>) => TResult1 | PromiseLike<TResult1>)
			| undefined
			| null,
		onrejected?:
			| ((reason: any) => TResult2 | PromiseLike<TResult2>)
			| undefined
			| null,
	): Promise<TResult1 | TResult2> {
		let arg = await mergeArgs(...this.#args);
		let envs: Array<tg.Unresolved<std.env.Arg>> = [];
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
			let linuxMount = await tg.build(linuxRootMount, arg.host);
			if (arg.mounts === undefined) {
				arg.mounts = [linuxMount];
			} else {
				arg.mounts.unshift(linuxMount);
			}
		}
		return (
			tg.Command.new(arg as tg.Command.Arg.Object) as Promise<tg.Command<A, R>>
		).then(onfulfilled, onrejected);
	}
}

export const mergeArgs = async (
	...args: std.Args<CommandArgObject>
): Promise<CommandArgObject> => {
	return await std.args.apply<CommandArgObject, CommandArgObject>({
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
				return { ...obj, env: obj.env as std.env.EnvObject };
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

export const defaultTemplateCommandArg = (
	strings: TemplateStringsArray,
	...placeholders: std.Args<tg.Template.Arg>
): tg.Unresolved<CommandArgObject> => {
	let template = tg.template(strings, ...placeholders);
	return { executable: "/bin/sh", args: ["-c", template] };
};

export const defaultCommandArg = async (hostArg?: tg.Unresolved<string>) => {
	const host = hostArg ? await tg.resolve(hostArg) : std.triple.host();
	// build the default args.
	let arg: tg.Command.Arg.Object = {};
	if (std.triple.os(host) === "linux") {
		let builtMount = await tg.build(linuxRootMount, host);
		arg.mounts = [builtMount];
	}
	const defaultEnv = await tg.build(std.utils.env, { host });
	arg.env = defaultEnv;
	return arg;
};

/** Build the default shell, returning the file directly. */
export const buildDefaultBash = async (hostArg?: tg.Unresolved<string>) => {
	const host = hostArg ? await tg.resolve(hostArg) : std.triple.host();
	return await tg
		.build(std.utils.bash.build, { host })
		.then((dir) => dir.get("bin/bash"))
		.then(tg.File.expect);
};

/** Get the default mount for the platform. */
export const linuxRootMount = async (
	hostArg: tg.Unresolved<string>,
): Promise<tg.Command.Mount> => {
	const host = await tg.resolve(hostArg);
	const os = std.triple.os(host);
	tg.assert(
		os === "linux",
		"the default root mount is only available for Linux",
	);
	const shellExe = bootstrap
		.shell(host)
		.then((d) => d.get("bin/sh"))
		.then(tg.File.expect);
	const envExe = bootstrap
		.env(host)
		.then((d) => d.get("bin/env"))
		.then(tg.File.expect);
	const root = await tg.directory({
		[`bin/sh`]: shellExe,
		[`usr/bin/env`]: envExe,
	});
	return {
		source: root,
		target: "/",
	};
};
