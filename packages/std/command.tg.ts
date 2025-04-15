import * as std from "./tangram.ts";
import * as bootstrap from "./bootstrap.tg.ts";

export function run(...args: tg.Args<tg.Process.RunArg>): Promise<tg.Value>;
export function run(
	strings: TemplateStringsArray,
	...placeholders: tg.Args<tg.Template.Arg>
): RunBuilder;
export function run(...args: any): any {
	if (Array.isArray(args[0]) && "raw" in args[0]) {
		let strings = args[0] as TemplateStringsArray;
		let placeholders = args.slice(1);
		let arg = defaultTemplateCommandArg(strings, ...placeholders);
		return new RunBuilder(arg);
	} else {
		return tg.run(defaultCommandArg(), ...args);
	}
}

export function build(...args: tg.Args<tg.Process.BuildArg>): Promise<tg.Value>;
export function build(
	strings: TemplateStringsArray,
	...placeholders: tg.Args<tg.Template.Arg>
): BuildBuilder;
export function build(...args: any): any {
	if (Array.isArray(args[0]) && "raw" in args[0]) {
		let strings = args[0] as TemplateStringsArray;
		let placeholders = args.slice(1);
		let arg = defaultTemplateCommandArg(strings, ...placeholders);
		return new BuildBuilder(arg);
	} else {
		return tg.build(defaultCommandArg(), ...args);
	}
}

export function command<
	A extends Array<tg.Value> = Array<tg.Value>,
	R extends tg.Value = tg.Value,
>(...args: tg.Args<tg.Command.Arg>): Promise<tg.Command<A, R>>;
export function command<
	A extends Array<tg.Value> = Array<tg.Value>,
	R extends tg.Value = tg.Value,
>(
	strings: TemplateStringsArray,
	...placeholders: tg.Args<tg.Template.Arg>
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

type BuildArgObject = {
	args?: Array<tg.Value> | undefined;
	checksum?: tg.Checksum | undefined;
	cwd?: string | undefined;
	env?: std.env.Arg | Array<std.env.Arg> | undefined;
	executable?: tg.Command.ExecutableArg | undefined;
	host?: string | undefined;
	mounts?: Array<string | tg.Template | tg.Command.Mount> | undefined;
	network?: boolean | undefined;
	stdin?: tg.Blob.Arg | undefined;
	user?: string | undefined;
};

type CommandArgObject = {
	args?: Array<tg.Value> | undefined;
	cwd?: string | undefined;
	env?: std.env.Arg | Array<std.env.Arg> | undefined;
	executable?: tg.Command.ExecutableArg | undefined;
	host?: string | undefined;
	mounts?: Array<string | tg.Template | tg.Command.Mount> | undefined;
	stdin?: tg.Blob.Arg | undefined;
	user?: string | undefined;
};

export class BuildBuilder {
	#args: tg.Args<BuildArgObject>;
	#defaultMount: boolean;
	#includeUtils: boolean;

	constructor(...args: tg.Args<BuildArgObject>) {
		this.#args = args;
		this.#defaultMount = true;
		this.#includeUtils = true;
	}

	args(args: tg.Unresolved<tg.MaybeMutation<Array<tg.Value>>>): this {
		this.#args.push({ args });
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

	env(env: tg.Unresolved<tg.MaybeMutation<std.env.Arg>>): this {
		this.#args.push({ env });
		return this;
	}

	executable(
		executable: tg.Unresolved<tg.MaybeMutation<tg.Command.ExecutableArg>>,
	): this {
		this.#args.push({ executable });
		return this;
	}

	host(host: tg.Unresolved<tg.MaybeMutation<string>>): this {
		this.#args.push({ host });
		return this;
	}

	mount(
		mounts: tg.Unresolved<
			tg.MaybeMutation<Array<string | tg.Template | tg.Command.Mount>>
		>,
	): this {
		this.#args.push({ mounts });
		return this;
	}

	network(network: tg.Unresolved<tg.MaybeMutation<boolean>>): this {
		this.#args.push({ network });
		return this;
	}

	async mergeArgs(): Promise<BuildArgObject> {
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
					return arg as BuildArgObject;
				}
			}),
		);
		let arg = await tg.Args.apply(objects, {
			args: "append",
			env: "merge",
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
		if (this.#includeUtils) {
			envs.push(buildUtilsEnv());
		}
		let tangramHost = await std.triple.host();
		envs.push({
			TANGRAM_HOST: tg.Mutation.setIfUnset(tangramHost),
		});
		if (arg.host === undefined) {
			arg.host = tangramHost;
		}
		if (Array.isArray(arg.env)) {
			envs.push(...arg.env);
		} else {
			envs.push(arg.env);
		}
		arg.env = await std.env.arg(...envs);
		const shellVal = await std.env.tryGetKey({
			env: arg.env as std.env.Arg,
			key: "SHELL",
		});
		if (shellVal !== undefined) {
			const components = shellVal.components;
			switch (components.length) {
				case 1: {
					const [firstComponent] = components;
					if (firstComponent) {
						arg.executable = firstComponent;
					}
				}
				case 2: {
					const [directory, subpath] = components;
					if (
						directory &&
						typeof directory !== "string" &&
						directory instanceof tg.Directory &&
						subpath &&
						typeof subpath === "string"
					) {
						arg.executable = await directory.get(subpath.slice(1));
					}
				}
			}
		} else {
			arg.executable = await buildDefaultBash();
		}
		if (std.triple.os(arg.host) === "linux" && this.#defaultMount) {
			let linuxMount = await buildLinuxRootMount();
			if (arg.mounts === undefined) {
				arg.mounts = [linuxMount];
			} else {
				arg.mounts.unshift(linuxMount);
			}
		}
		return tg.build(arg as tg.Process.BuildArgObject).then(onfulfilled, onrejected);
	}
}

export class CommandBuilder<
	A extends Array<tg.Value> = Array<tg.Value>,
	R extends tg.Value = tg.Value,
> {
	#args: tg.Args<CommandArgObject>;
	#defaultMount: boolean;
	#includeUtils: boolean;

	constructor(...args: tg.Args<CommandArgObject>) {
		this.#args = args;
		this.#defaultMount = true;
		this.#includeUtils = true;
	}

	args(args: tg.Unresolved<tg.MaybeMutation<Array<tg.Value>>>): this {
		this.#args.push({ args });
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

	env(env: tg.Unresolved<tg.MaybeMutation<std.env.Arg>>): this {
		this.#args.push({ env });
		return this;
	}

	executable(
		executable: tg.Unresolved<tg.MaybeMutation<tg.Command.ExecutableArg>>,
	): this {
		this.#args.push({ executable });
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
		mounts: tg.Unresolved<
			tg.MaybeMutation<Array<string | tg.Template | tg.Command.Mount>>
		>,
	): this {
		this.#args.push({ mounts });
		return this;
	}

	
		async mergeArgs(): Promise<CommandArgObject> {
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
					};
				} else if (arg instanceof tg.Command) {
					return await arg.object();
				} else {
					return arg as CommandArgObject;
				}
			}),
		);
		let arg = await tg.Args.apply(objects, {
			args: "append",
			env: "append",
		});
		return arg;
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
		let arg = await this.mergeArgs();
		let envs: Array<tg.Unresolved<std.env.Arg>> = [];
		if (this.#includeUtils) {
			envs.push(buildUtilsEnv());
		}
		let tangramHost = await std.triple.host();
		envs.push({
			TANGRAM_HOST: tg.Mutation.setIfUnset(tangramHost),
		});
		if (arg.host === undefined) {
			arg.host = tangramHost;
		}
		if (Array.isArray(arg.env)) {
			envs.push(...arg.env);
		} else {
			envs.push(arg.env);
		}
		arg.env = await std.env.arg(...envs);
		const shellVal = await std.env.tryGetKey({
			env: arg.env as std.env.Arg,
			key: "SHELL",
		});
		if (shellVal !== undefined) {
			const components = shellVal.components;
			switch (components.length) {
				case 1: {
					const [firstComponent] = components;
					if (firstComponent) {
						arg.executable = firstComponent;
					}
				}
				case 2: {
					const [directory, subpath] = components;
					if (
						directory &&
						typeof directory !== "string" &&
						directory instanceof tg.Directory &&
						subpath &&
						typeof subpath === "string"
					) {
						arg.executable = await directory.get(subpath.slice(1));
					}
				}
			}
		} else {
			arg.executable = await buildDefaultBash();
		}

		if (std.triple.os(arg.host) === "linux" && this.#defaultMount) {
			let linuxMount = await buildLinuxRootMount();
			if (arg.mounts === undefined) {
				arg.mounts = [linuxMount];
			} else {
				arg.mounts.unshift(linuxMount);
			}
		}
		const command: Promise<tg.Command<A, R>> = tg.command(arg as tg.Command.ArgObject);
		return command.then(onfulfilled, onrejected);
	}
}

export class RunBuilder {
	#args: tg.Args<RunArgObject>;
	#defaultMount: boolean;
	#includeUtils: boolean;

	constructor(...args: tg.Args<RunArgObject>) {
		this.#args = args;
		this.#defaultMount = true;
		this.#includeUtils = true;
	}

	args(args: tg.Unresolved<tg.MaybeMutation<Array<tg.Value>>>): this {
		this.#args.push({ args });
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

	env(env: tg.Unresolved<tg.MaybeMutation<std.env.Arg>>): this {
		this.#args.push({ env });
		return this;
	}

	executable(
		executable: tg.Unresolved<tg.MaybeMutation<tg.Command.ExecutableArg>>,
	): this {
		this.#args.push({ executable });
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
		mounts: tg.Unresolved<
			tg.MaybeMutation<
				Array<string | tg.Template | tg.Command.Mount | tg.Process.Mount>
			>
		>,
	): this {
		this.#args.push({ mounts });
		return this;
	}

	network(network: tg.Unresolved<tg.MaybeMutation<boolean>>): this {
		this.#args.push({ network });
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
					return arg as RunArgObject;
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
		if (this.#includeUtils) {
			envs.push(buildUtilsEnv());
		}
		let tangramHost = await std.triple.host();
		envs.push({
			TANGRAM_HOST: tg.Mutation.setIfUnset(tangramHost),
		});
		if (arg.host === undefined) {
			arg.host = tangramHost;
		}
		if (Array.isArray(arg.env)) {
			envs.push(...arg.env);
		} else {
			envs.push(arg.env);
		}
		arg.env = await std.env.arg(...envs);
		const shellVal = await std.env.tryGetKey({
			env: arg.env as std.env.Arg,
			key: "SHELL",
		});
		if (shellVal !== undefined) {
			const components = shellVal.components;
			switch (components.length) {
				case 1: {
					const [firstComponent] = components;
					if (firstComponent) {
						arg.executable = firstComponent;
					}
				}
				case 2: {
					const [directory, subpath] = components;
					if (
						directory &&
						typeof directory !== "string" &&
						directory instanceof tg.Directory &&
						subpath &&
						typeof subpath === "string"
					) {
						arg.executable = await directory.get(subpath.slice(1));
					}
				}
			}
		} else {
			arg.executable = await buildDefaultBash();
		}
		if (std.triple.os(arg.host) === "linux" && this.#defaultMount) {
			let linuxMount = await buildLinuxRootMount();
			if (arg.mounts === undefined) {
				arg.mounts = [linuxMount];
			} else {
				arg.mounts.unshift(linuxMount);
			}
		}
		return tg.run(arg as tg.Process.RunArgObject).then(onfulfilled, onrejected);
	}
}

/** For use inside std - includes the default mount, but not the env. */
export const runBootstrap = async (
	...args: tg.Args<tg.Process.RunArg>
): Promise<tg.Value> => {
	let arg: tg.Process.BuildArg = {};
	if (std.triple.os(await std.triple.host()) === "linux") {
		arg.mounts = [await buildLinuxRootMount()];
	}
	return tg.run(arg, ...args);
};

/** For use inside std - includes the default mount, but not the env. */
export const buildBootstrap = async (
	...args: tg.Args<tg.Process.BuildArg>
): Promise<tg.Value> => {
	let arg: tg.Process.BuildArg = {};
	if (std.triple.os(await std.triple.host()) === "linux") {
		arg.mounts = [await buildLinuxRootMount()];
	}
	return tg.build(arg, ...args);
};

export const defaultTemplateCommandArg = (
	strings: TemplateStringsArray,
	...placeholders: tg.Args<tg.Template.Arg>
): tg.Unresolved<CommandArgObject> => {
	let template = tg.template(strings, ...placeholders);
	return { args: ["-c", template] };
};

export const defaultCommandArg = async (hostArg?: string) => {
	const host = hostArg ?? (await std.triple.host());
	// build the default args.
	let arg: tg.Command.ArgObject = {};
	if (std.triple.os(host) === "linux") {
		let builtMount = await linuxRootMount.build(host);
		arg.mounts = [builtMount];
	}
	const defaultEnv = await buildUtilsEnv(host);
	arg.env = defaultEnv;
	return arg;
};

/** Build the default env. */
export const buildUtilsEnv = async (
	hostArg?: string,
): Promise<std.env.EnvObject> => {
	const host = hostArg ?? (await std.triple.host());
	return await std.utils.env({ sdk: false, host, env: buildSdk(host) });
};

/** Build the default shell, returning the file directly. */
export const buildDefaultBash = async (hostArg?: string): Promise<tg.File> => {
	const host = hostArg ?? (await std.triple.host());
	return await std.utils.bash.build
		.build({ host })
		.then((dir) => dir.get("bin/bash"))
		.then(tg.File.expect);
};

export const buildSdk = (host?: string) => {
	return sdk.build(host);
};

export const sdk = tg.command(async (hostArg?: string) => {
	const host = hostArg ?? (await std.triple.host());
	return std.sdk({ host });
});

export const buildLinuxRootMount = async (
	hostArg?: string,
): Promise<tg.Command.Mount> => {
	const host = hostArg ?? (await std.triple.host());
	return await linuxRootMount.build(host);
};

/** Get the default mount for the platform. */
export const linuxRootMount = tg.command(
	async (host: string): Promise<tg.Command.Mount> => {
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
		const root = tg.directory({
			[`bin/sh`]: shellExe,
			[`usr/bin/env`]: envExe,
		});
		const mountArg = await tg`${root}:/`;
		return await tg.Command.Mount.parse(mountArg);
	},
);

export const testBuild = async () => {
	const expected = await tg.process.env("TANGRAM_HOST");
	const output = await std.build`echo $TANGRAM_HOST > $OUTPUT`.then(
		tg.File.expect,
	);
	const actual = (await output.text()).trim();
	tg.assert(actual === expected, `expected ${actual} to equal ${expected}`);
	return true;
};

export const testDollar = tg.command(async () => {
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
});

export const testDollarBootstrap = tg.command(async () => {
	const f = tg.file("hello there!!!\n");
	const utils = bootstrap.utils();
	const output = await $`cat ${f} > $OUTPUT
		echo $NAME >> $OUTPUT
		echo $TOOL >> $OUTPUT`
		.includeUtils(false)
		.env({ NAME: "ben" })
		.env({ TOOL: "tangram" })
		.env({ SHELL: "/bin/sh" })
		.env({ NAME: tg.Mutation.suffix("L.", " ") })
		.env(utils)
		.then(tg.File.expect);
	const actual = await output.text();
	const expected = "hello there!!!\nben L.\ntangram\n";
	tg.assert(actual === expected, `expected ${actual} to equal ${expected}`);
	return true;
});

export const testEnvClear = tg.command(async () => {
	const output = await $`/usr/bin/env > $OUTPUT`
		.includeUtils(false)
		.env({ FOO: "foo!" })
		.env({ BAR: "bar!" })
		.env(tg.Mutation.set({ BAZ: "baz!", SHELL: "/bin/sh" }))
		.then(tg.File.expect);
	const actual = await output.text();
	console.log("actual", actual);
	tg.assert(actual.includes("baz!"), "expected output to contain `baz!`");
	tg.assert(!actual.includes("foo!"), "expected output to not contain `foo!`");
	return true;
});
