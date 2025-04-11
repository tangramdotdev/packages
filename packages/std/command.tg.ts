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
		return new RunBuilder(strings, ...placeholders);
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
		return new BuildBuilder(strings, ...placeholders);
	} else {
		return tg.build(defaultCommandArg(), ...args);
	}
}

export function command(...args: tg.Args<tg.Command.Arg>): Promise<tg.Command>;
export function command(
	strings: TemplateStringsArray,
	...placeholders: tg.Args<tg.Template.Arg>
): CommandBuilder;
export function command(...args: any): any {
	if (Array.isArray(args[0]) && "raw" in args[0]) {
		let strings = args[0] as TemplateStringsArray;
		let placeholders = args.slice(1);
		return new CommandBuilder(strings, ...placeholders);
	} else {
		return tg.command(defaultCommandArg(), ...args);
	}
}

export const $ = run;

/** For use inside std - includes the default mount, but not the env. */
export const buildBootstrap = async (
	...args: tg.Args<tg.Process.BuildArg>
): Promise<tg.Value> => {
	let arg: tg.Process.BuildArg = {};
	let defaultMount = await buildDefaultMount();
	if (defaultMount !== undefined) {
		arg.mounts = [defaultMount];
	}
	return tg.build(arg, ...args);
};

/** For use inside std - includes the default mount, but not the env. */
export const runBootstrap = async (
	...args: tg.Args<tg.Process.RunArg>
): Promise<tg.Value> => {
	let arg: tg.Process.RunArg = {};
	let defaultMount = await buildDefaultMount();
	if (defaultMount !== undefined) {
		arg.mounts = [defaultMount];
	}
	return tg.run(arg, ...args);
};

class BaseBuilder {
	protected _args?: Array<tg.Unresolved<tg.Value>>;
	protected _checksum?: tg.Checksum | undefined;
	protected _cwd?: string | undefined;
	protected _defaultMount?: boolean;
	protected _disallowUnset: boolean;
	protected _env?: tg.Args<std.env.Arg>;
	protected _executable?: tg.Unresolved<tg.Command.ExecutableArg>;
	protected _exitOnErr: boolean;
	protected _includeUtils: boolean;
	protected _host?: string;
	protected _commandMounts?: Array<tg.Command.Mount>;
	protected _mounts?: Array<string | tg.Template | tg.Process.Mount>;
	protected _network: boolean;
	protected _pipefail: boolean;
	protected _placeholders: tg.Args<tg.Template.Arg>;
	protected _strings: TemplateStringsArray;

	constructor(
		strings: TemplateStringsArray,
		...placeholders: tg.Args<tg.Template.Arg>
	) {
		this._defaultMount = true;
		this._includeUtils = true;
		this._network = false;
		this._strings = strings;
		this._placeholders = placeholders;
		this._disallowUnset = true;
		this._exitOnErr = true;
		this._pipefail = true;
	}

	args(...args: Array<tg.Unresolved<tg.Value>>): this {
		if (args.length > 0) {
			if (this._args === undefined) {
				this._args = [];
			}
			this._args.push(...args);
		}
		return this;
	}

	checksum(checksum: tg.Checksum | undefined): this {
		this._checksum = checksum;
		return this;
	}

	cwd(cwd: string | undefined): this {
		this._cwd = cwd;
		return this;
	}

	disallowUnset(bool: boolean): this {
		this._disallowUnset = bool;
		return this;
	}

	env(...envArgs: tg.Args<std.env.Arg>): this {
		if (this._env === undefined) {
			this._env = envArgs;
		} else {
			this._env.push(...envArgs);
		}
		return this;
	}

	executable(executable: tg.Unresolved<tg.Command.ExecutableArg>): this {
		this._executable = executable;
		return this;
	}

	exitOnErr(bool: boolean): this {
		this._exitOnErr = bool;
		return this;
	}

	host(host: string): this {
		this._host = host;
		return this;
	}

	includeUtils(bool: boolean): this {
		this._includeUtils = bool;
		return this;
	}

	mount(
		...mounts: Array<string | tg.Template | tg.Command.Mount | tg.Process.Mount>
	): this {
		// TODO - specialize this for BuildBuilder.
		for (const mount of mounts) {
			if (typeof mount === "string" || mount instanceof tg.Template) {
				if (this._mounts === undefined) {
					this._mounts = [];
				}
				this._mounts.push(mount);
			} else {
				if ("readonly" in mount) {
					if (this._mounts === undefined) {
						this._mounts = [];
					}
					this._mounts.push(mount);
				} else {
					if (this._commandMounts === undefined) {
						this._commandMounts = [];
					}
					this._commandMounts.push(mount);
				}
			}
		}
		return this;
	}

	network(bool: boolean): this {
		this._network = bool;
		return this;
	}

	pipefail(bool: boolean): this {
		this._pipefail = bool;
		return this;
	}

	async command(): Promise<tg.Command> {
		const arg: tg.Command.ArgObject = {};

		// Set host.
		if (this._host !== undefined) {
			arg.host = this._host;
		} else {
			arg.host = await std.triple.host();
		}

		// Construct the env.
		const envs: tg.Args<std.env.Arg> = [];
		if (this._env !== undefined) {
			envs.push(...this._env);
		}
		if (this._includeUtils) {
			const utilsEnv = await buildUtilsEnv(arg.host);
			envs.push(utilsEnv);
		}
		let tangramHost = (await tg.process.env("TANGRAM_HOST")) as string;
		envs.push({
			TANGRAM_HOST: tg.Mutation.setIfUnset(tangramHost),
		});
		arg.env = await std.env.arg(...envs);

		// Construct the executable.
		if (this._executable !== undefined) {
			// If the user specified a custom executable, use that.
			arg.executable = await tg.resolve(this._executable);
		} else {
			// If the env has the SHELL key set to an artifact, use that.
			const shellArtifact = await std.env.tryGetArtifactByKey({
				env: arg.env as std.env.Arg,
				key: "SHELL",
			});
			if (shellArtifact !== undefined) {
				arg.executable = shellArtifact;
			} else {
				// Otherwise, use the default bash executable from the standard utils.
				arg.executable = await buildDefaultBash(arg.host);
			}
		}

		// Construct the args.
		arg.args = [];
		if (this._disallowUnset) {
			arg.args.push("-u");
		}
		if (this._exitOnErr) {
			arg.args.push("-e");
		}
		if (this._pipefail) {
			arg.args.push("-o");
			arg.args.push("pipefail");
		}
		arg.args.push("-c");
		arg.args.push(await tg(this._strings, ...std.flatten(this._placeholders)));

		// Set cwd.
		if (this._cwd !== undefined) {
			arg.cwd = this._cwd;
		}

		// Set mounts.
		if (this._defaultMount) {
			const defaultMount_ = await buildDefaultMount(arg.host);
			if (defaultMount_ !== undefined) {
				this.mount(defaultMount_);
			}
		}
		if (this._commandMounts !== undefined) {
			arg.mounts = this._commandMounts;
		}

		return await tg.command(arg);
	}
}

class RunBuilder extends BaseBuilder {
	async build(): Promise<tg.Value> {
		if (this._mounts !== undefined && this._mounts.length > 0) {
			throw new Error("cannot build a command with process mounts");
		}
		return await tg.build(await this.command(), {
			checksum: this._checksum,
			network: this._network,
		});
	}

	async run(): Promise<tg.Value> {
		const args: Array<tg.Process.RunArg> = [
			{ checksum: this._checksum, network: this._network },
		];
		if ((this._mounts?.length ?? 0) > 0) {
			args.push({ mounts: this._mounts });
		}
		return await tg.run(this.command(), ...args);
	}

	then<TResult1 = tg.Value, TResult2 = never>(
		onfulfilled?:
			| ((value: tg.Value) => TResult1 | PromiseLike<TResult1>)
			| undefined
			| null,
		onrejected?:
			| ((reason: any) => TResult2 | PromiseLike<TResult2>)
			| undefined
			| null,
	): PromiseLike<TResult1 | TResult2> {
		return this.run().then(onfulfilled, onrejected);
	}
}

class BuildBuilder extends BaseBuilder {
	async build(): Promise<tg.Value> {
		if (this._mounts !== undefined && this._mounts.length > 0) {
			throw new Error("cannot build a command with process mounts");
		}
		return await tg.build(await this.command(), {
			checksum: this._checksum,
			network: this._network,
		});
	}

	then<TResult1 = tg.Value, TResult2 = never>(
		onfulfilled?:
			| ((value: tg.Value) => TResult1 | PromiseLike<TResult1>)
			| undefined
			| null,
		onrejected?:
			| ((reason: any) => TResult2 | PromiseLike<TResult2>)
			| undefined
			| null,
	): PromiseLike<TResult1 | TResult2> {
		return this.build().then(onfulfilled, onrejected);
	}
}

class CommandBuilder extends BaseBuilder {
	then<TResult1 = tg.Command, TResult2 = never>(
		onfulfilled?:
			| ((value: tg.Command) => TResult1 | PromiseLike<TResult1>)
			| undefined
			| null,
		onrejected?:
			| ((reason: any) => TResult2 | PromiseLike<TResult2>)
			| undefined
			| null,
	): PromiseLike<TResult1 | TResult2> {
		return this.command().then(onfulfilled, onrejected);
	}
}

export const defaultCommandArg = async (hostArg?: string) => {
	const host = hostArg ?? (await std.triple.host());
	// build the default args.
	let arg: tg.Command.ArgObject = {};
	if (std.triple.os(host) === "linux") {
		let builtMount = await defaultMount.build(host);
		tg.assert(
			builtMount !== undefined,
			"expected linux to produce a default mount",
		);
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

export const buildDefaultMount = async (
	hostArg?: string,
): Promise<tg.Command.Mount | undefined> => {
	const host = hostArg ?? (await std.triple.host());
	return await defaultMount.build(host);
};

/** Get the default mount for the platform. */
export const defaultMount = tg.command(
	async (host: string): Promise<tg.Command.Mount | undefined> => {
		const os = std.triple.os(host);
		if (os === "darwin") {
			return undefined;
		} else if (os === "linux") {
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
		} else {
			return tg.unreachable(`unexpected OS ${os}`);
		}
	},
);

export const testBuild = async () => {
	const expected = await tg.process.env("TANGRAM_HOST");
	const output = await std
		.build`echo $TANGRAM_HOST > $OUTPUT`
		.then(tg.File.expect);
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
		.executable("/bin/sh")
		.env({ NAME: "ben" })
		.env({ TOOL: "tangram" })
		.env({ NAME: tg.Mutation.suffix("L.", " ") })
		.env(utils)
		.then(tg.File.expect);
	const actual = await output.text();
	const expected = "hello there!!!\nben L.\ntangram\n";
	tg.assert(actual === expected, `expected ${actual} to equal ${expected}`);
	return true;
});
