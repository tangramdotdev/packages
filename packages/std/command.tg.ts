import * as std from "./tangram.ts";
import { createMutations, applyMutations } from "./args.tg.ts";
import * as bootstrap from "./bootstrap.tg.ts";

export const command = async (
	...args: tg.Args<tg.Command.Arg>
): Promise<tg.Command> => {
	return await tg.command(defaultCommandArg(), ...args);
};

// TODO - this is the same as RunBuilder, but does not support build or run, then() just calls command().
// class CommandBuilder {
// 	then(): Promise<tg.Command> {}
// }

export function build(...args: tg.Args<tg.Process.BuildArg>): Promise<tg.Value>;
// export function build(
// 	strings: TemplateStringsArray,
// 	...placeholders: tg.Args<tg.Template.Arg>
// ): BuildBuilder
export async function build(...args: any): Promise<any> {
	return await tg.build(defaultCommandArg(), ...args);
}

// TODO - this is the same as RunBuilder, but does not support mounts, and the then() calls build instead of run.
// class BuildBuilder {
// 	then(): Promise<tg.Value> {}
// }

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

export const $ = run;

class RunBuilder {
	#args?: Array<tg.Unresolved<tg.Value>>;
	#checksum?: tg.Checksum | undefined;
	#cwd?: string | undefined;
	#defaultMount?: boolean;
	#disallowUnset: boolean;
	#env?: tg.Args<std.env.Arg>;
	#executable?: tg.Unresolved<tg.Command.ExecutableArg>;
	#exitOnErr: boolean;
	#includeUtils: boolean;
	#host?: string;
	#commandMounts?: Array<tg.Command.Mount>;
	#mounts?: Array<string | tg.Template | tg.Process.Mount>;
	#network: boolean;
	#pipefail: boolean;
	#placeholders: tg.Args<tg.Template.Arg>;
	#strings: TemplateStringsArray;

	constructor(
		strings: TemplateStringsArray,
		...placeholders: tg.Args<tg.Template.Arg>
	) {
		this.#defaultMount = true;
		this.#includeUtils = false;
		this.#network = false;
		this.#includeUtils = true;
		this.#strings = strings;
		this.#placeholders = placeholders;
		this.#disallowUnset = true;
		this.#exitOnErr = true;
		this.#pipefail = true;
	}

	args(...args: Array<tg.Unresolved<tg.Value>>): RunBuilder {
		if (args.length > 0) {
			if (this.#args === undefined) {
				this.#args = [];
			}
			this.#args.push(...args);
		}
		return this;
	}

	async build(): Promise<tg.Value> {
		if (this.#mounts !== undefined && this.#mounts.length > 0) {
			throw new Error("cannot build a command with process mounts");
		}
		return await tg.build(await this.command(), {
			checksum: this.#checksum,
			network: this.#network,
		});
	}

	checksum(checksum: tg.Checksum | undefined): RunBuilder {
		this.#checksum = checksum;
		return this;
	}

	cwd(cwd: string | undefined): RunBuilder {
		this.#cwd = cwd;
		return this;
	}

	disallowUnset(bool: boolean): RunBuilder {
		this.#disallowUnset = bool;
		return this;
	}

	env(...envArgs: tg.Args<std.env.Arg>): RunBuilder {
		if (this.#env === undefined) {
			this.#env = envArgs;
		} else {
			this.#env.push(...envArgs);
		}
		return this;
	}

	executable(executable: tg.Unresolved<tg.Command.ExecutableArg>): RunBuilder {
		this.#executable = executable;
		return this;
	}

	exitOnErr(bool: boolean): RunBuilder {
		this.#exitOnErr = bool;
		return this;
	}

	host(host: string): RunBuilder {
		this.#host = host;
		return this;
	}

	includeUtils(bool: boolean): RunBuilder {
		this.#includeUtils = bool;
		return this;
	}

	mount(
		...mounts: Array<string | tg.Template | tg.Command.Mount | tg.Process.Mount>
	): RunBuilder {
		for (const mount of mounts) {
			if (typeof mount === "string" || mount instanceof tg.Template) {
				if (this.#mounts === undefined) {
					this.#mounts = [];
				}
				this.#mounts.push(mount);
			} else {
				if ("readonly" in mount) {
					if (this.#mounts === undefined) {
						this.#mounts = [];
					}
					this.#mounts.push(mount);
				} else {
					if (this.#commandMounts === undefined) {
						this.#commandMounts = [];
					}
					this.#commandMounts.push(mount);
				}
			}
		}
		return this;
	}

	network(bool: boolean): RunBuilder {
		this.#network = bool;
		return this;
	}

	pipefail(bool: boolean): RunBuilder {
		this.#pipefail = bool;
		return this;
	}

	async command(): Promise<tg.Command> {
		const arg: tg.Command.ArgObject = {};

		// Set host.
		if (this.#host !== undefined) {
			arg.host = this.#host;
		} else {
			arg.host = await std.triple.host();
		}

		// Construct the env.
		const envs: tg.Args<std.env.Arg> = [];
		if (this.#env !== undefined) {
			envs.push(...this.#env);
		}
		if (this.#includeUtils) {
			// FIXME - what about this SDK? Why am I doing this here? Autotools coupled utils + sdk?
			const utilsEnv = await buildUtilsEnv({
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
		if (this.#executable !== undefined) {
			// If the user specified a custom executable, use that.
			arg.executable = await tg.resolve(this.#executable);
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
				arg.executable = await buildDefaultBash({ host: arg.host });
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
		if (this.#cwd !== undefined) {
			arg.cwd = this.#cwd;
		}

		// Set mounts.
		if (this.#defaultMount) {
			// FIXME build.
			const defaultMount_ = await defaultMount(arg.host);
			if (defaultMount_ !== undefined) {
				this.mount(defaultMount_);
			}
		}
		if (this.#commandMounts !== undefined) {
			arg.mounts = this.#commandMounts;
		}

		return await tg.command(arg);
	}

	async run(): Promise<tg.Value> {
		const args: Array<tg.Process.RunArg> = [
			{ checksum: this.#checksum, network: this.#network },
		];
		if ((this.#mounts?.length ?? 0) > 0) {
			args.push({ mounts: this.#mounts });
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
	// FIXME - this sdk needs to be built.
	const defaultEnv = await buildUtilsEnv({ sdk: false, host, env: std.sdk() });
	return arg;
};

/** Build the default env. */
export const buildUtilsEnv = async (
	arg: tg.Unresolved<std.utils.Arg>,
): Promise<std.env.EnvObject> => {
	return await std.utils.env(arg);
};

/** Build the default shell, returning the file directly. */
export const buildDefaultBash = async (
	arg: tg.Unresolved<std.utils.bash.Arg>,
): Promise<tg.File> => {
	return await std.utils.bash
		.build(arg)
		.then((dir) => dir.get("bin/bash"))
		.then(tg.File.expect);
};

// export const buildDefaultMount = async (): Promise<tg.Command.Mount | undefined> => {

// }

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
	// FIXME - test template form.
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
