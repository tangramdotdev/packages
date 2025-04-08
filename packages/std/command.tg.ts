import * as std from "./tangram.ts";
import { createMutations, applyMutations } from "./args.tg.ts";
import * as bootstrap from "./bootstrap.tg.ts";

export function $(
	strings: TemplateStringsArray,
	...placeholders: std.args.UnresolvedArgs<tg.Template.Arg>
): Dollar {
	return new Dollar(strings, placeholders);
}

/** Helper to construct commands with additional spawn args. */
class CommandBuilder {
	protected _args?: Array<tg.Unresolved<tg.Value>>;
	protected _checksum?: tg.Checksum | undefined;
	protected _cwd?: string | undefined;
	protected _defaultMount?: boolean;
	protected _env?: Array<tg.Unresolved<std.env.Arg>>;
	protected _executable?: tg.Unresolved<tg.Command.ExecutableArg>;
	protected _includeUtils: boolean;
	protected _host?: string;
	protected _commandMounts?: Array<tg.Command.Mount>;
	protected _mounts?: Array<string | tg.Template | tg.Process.Mount>;
	protected _network: boolean;

	constructor(arg?: tg.Process.RunArgObject) {
		this._defaultMount = true;
		this._includeUtils = false;
		this._network = false;

		if (arg !== undefined) {
			if (arg.args !== undefined) {
				this._args = arg.args;
			}
			if (arg.checksum !== undefined) {
				this._checksum = arg.checksum;
			}
			if (arg.env !== undefined) {
				this.env(arg.env as std.env.Arg);
			}
			if (arg.executable !== undefined) {
				this._executable = arg.executable;
			}
			if (arg.host !== undefined) {
				this._host = arg.host;
			}
			if (arg.cwd !== undefined) {
				this._cwd = arg.cwd;
			}
			if (arg.mounts !== undefined) {
				this.mount(...arg.mounts);
			}
			if (arg.network !== undefined) {
				this._network = arg.network;
			}
		}
	}

	args(...args: Array<tg.Unresolved<tg.Value>>): CommandBuilder {
		if (args.length > 0) {
			if (this._args === undefined) {
				this._args = [];
			}
			this._args.push(...args);
		}
		return this;
	}

	async build(): Promise<tg.Value> {
		if (this._mounts !== undefined && this._mounts.length > 0) {
			throw new Error("cannot build a command with process mounts");
		}
		return await tg.build(await this.command(), {
			checksum: this._checksum,
			network: this._network,
		});
	}

	checksum(checksum: tg.Checksum | undefined): CommandBuilder {
		this._checksum = checksum;
		return this;
	}

	cwd(cwd: string | undefined): CommandBuilder {
		this._cwd = cwd;
		return this;
	}

	env(...envArgs: Array<tg.Unresolved<std.env.Arg>>): CommandBuilder {
		if (this._env === undefined) {
			this._env = envArgs;
		} else {
			this._env.push(...envArgs);
		}
		return this;
	}

	executable(
		executable: tg.Unresolved<tg.Command.ExecutableArg>,
	): CommandBuilder {
		this._executable = executable;
		return this;
	}

	host(host: string): CommandBuilder {
		this._host = host;
		return this;
	}

	includeUtils(bool: boolean): CommandBuilder {
		this._includeUtils = bool;
		return this;
	}

	mount(
		...mounts: Array<string | tg.Template | tg.Command.Mount | tg.Process.Mount>
	): CommandBuilder {
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

	network(bool: boolean): CommandBuilder {
		this._network = bool;
		return this;
	}

	async run(): Promise<tg.Value> {
		const args: Array<tg.Process.RunArg> = [
			{ checksum: this._checksum, network: this._network },
		];
		if (this._mounts?.length > 0) {
			args.push({ mounts: this._mounts });
		}
		return await tg.run(this.command(), ...args);
	}

	async command(): Promise<tg.Command> {
		const arg: tg.Command.ArgObject = {};

		// Construct the executable.
		if (this._executable !== undefined) {
			// If the user specified a custom executable, use that.
			arg.executable = await tg.resolve(this._executable);
		}

		// Construct the args.
		arg.args = [];
		if (this._args !== undefined) {
			arg.args.push(
				...(await Promise.all(
					this._args.map(async (a) => await tg.resolve(a)),
				)),
			);
		}

		// Construct the env.
		const envs: Array<tg.Unresolved<std.env.Arg>> = [];
		if (this._env !== undefined) {
			envs.push(...this._env);
		}
		if (this._includeUtils) {
			const utilsEnv = std.utils.env({
				sdk: false,
				env: std.sdk(),
				host: arg.host,
			});
			envs.push(utilsEnv);
		}
		const tangramHost = (await tg.process.env("TANGRAM_HOST")) as string;
		envs.push({
			TANGRAM_HOST: tg.Mutation.setIfUnset(tangramHost),
		});
		arg.env = await std.env.arg(...envs);

		// Set host.
		if (this._host !== undefined) {
			arg.host = this._host;
		} else {
			arg.host = await std.triple.host();
		}

		// Set cwd.
		if (this._cwd !== undefined) {
			arg.cwd = this._cwd;
		}

		// Set mounts.
		if (this._defaultMount) {
			const defaultMount_ = await defaultMount(arg.host);
			if (defaultMount_ !== undefined) {
				this.mount(defaultMount_);
			}
		}

		if (this._commandMounts !== undefined) {
			arg.mounts = this._commandMounts;
		}

		let command = await tg.command(arg);
		return command;
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

/** Specialized command builder to specifically aid in producing shell commands. */
class Dollar extends CommandBuilder {
	#disallowUnset: boolean;
	#exitOnErr: boolean;
	#pipefail: boolean;
	#placeholders: std.args.UnresolvedArgs<tg.Template.Arg>;
	#strings: TemplateStringsArray;

	constructor(
		strings: TemplateStringsArray,
		...placeholders: std.args.UnresolvedArgs<tg.Template.Arg>
	) {
		super();
		this.includeUtils(true);
		this.#strings = strings;
		this.#placeholders = placeholders;
		this.#disallowUnset = true;
		this.#exitOnErr = true;
		this.#pipefail = true;
	}

	disallowUnset(bool: boolean): Dollar {
		this.#disallowUnset = bool;
		return this;
	}

	exitOnErr(bool: boolean): Dollar {
		this.#exitOnErr = bool;
		return this;
	}

	pipefail(bool: boolean): Dollar {
		this.#pipefail = bool;
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
		const envs: Array<tg.Unresolved<std.env.Arg>> = [];
		if (this._env !== undefined) {
			envs.push(...this._env);
		}
		if (this._includeUtils) {
			const utilsEnv = std.utils.env({
				sdk: false,
				env: std.sdk(),
				host: arg.host,
			});
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
				arg.executable = await std.utils.bash
					.build({ sdk: false, env: std.sdk(), host: arg.host })
					.then((dir) => dir.get("bin/bash"))
					.then(tg.File.expect);
			}
		}

		// Construct the args.
		arg.args = [];
		if (this.#disallowUnset) {
			arg.args.push("-u");
		}
		if (this.#exitOnErr) {
			arg.args.push("-e");
		}
		if (this.#pipefail) {
			arg.args.push("-o");
			arg.args.push("pipefail");
		}
		arg.args.push("-c");
		arg.args.push(await tg(this.#strings, ...std.flatten(this.#placeholders)));

		// Set cwd.
		if (this._cwd !== undefined) {
			arg.cwd = this._cwd;
		}

		// Set mounts.
		if (this._defaultMount) {
			const defaultMount_ = await defaultMount(arg.host);
			if (defaultMount_ !== undefined) {
				this.mount(defaultMount_);
			}
		}
		if (this._commandMounts !== undefined) {
			arg.mounts = this._commandMounts;
		}

		return await tg.command(arg);
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

/** Wrapper for tg.command that includes the default mounts. */
export const command = async (
	...args: std.Args<tg.Process.RunArg>
): Promise<CommandBuilder> => {
	const arg = await processArg(...args);
	const builder = new CommandBuilder(arg);
	return await builder.command();
};

/** Wrapper around tg.build that attaches the default mount to commands. */
export const build = async (
	...args: std.Args<tg.Process.RunArg>
): Promise<tg.Value> => {
	const arg = await processArg(...args);
	const commandBuilder = new CommandBuilder(arg);
	return await commandBuilder.build();
};

/** Wrapper around tg.run that attaches the default mount to commands. */
export const run = async (
	...args: std.Args<tg.Process.RunArg>
): Promise<tg.Value> => {
	const arg = await processArg(...args);
	const commandBuilder = new CommandBuilder(arg);
	return await commandBuilder.run();
};

/** Wrap a command with a default mount if the host is linux. For darwin, does not change the command. */
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

/** Process a set of spawn args. */
export const processArg = async (
	...args: std.Args<tg.Process.RunArg>
): Promise<tg.Process.RunArgObject> => {
	const resolved = await Promise.all(args.map(tg.resolve));
	const flattened = std.flatten(resolved);
	const objects = await Promise.all(
		flattened.map(async (arg) => {
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
				return { ...(await arg.object()) };
			} else {
				return arg;
			}
		}),
	);
	const mutations = await createMutations(objects, {
		args: "append",
		env: "append",
	});
	const arg = await applyMutations(mutations);
	return arg;
};

export const testBuild = async () => {
	const expected = await tg.process.env("TANGRAM_HOST");
	const output = await std
		.build(`echo $TANGRAM_HOST > $OUTPUT`)
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
