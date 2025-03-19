import * as std from "./tangram.ts";
import { createMutations, applyMutations } from "./args.tg.ts";
import * as bootstrap from "./bootstrap.tg.ts";

export function $(
	strings: TemplateStringsArray,
	...placeholders: std.args.UnresolvedArgs<tg.Template.Arg>
): CommandBuilder {
	const script = tg(strings, ...std.flatten(placeholders));
	const executable = std.utils.bash
		.build({ sdk: false, env: std.sdk() })
		.then((dir) => dir.get("bin/bash"))
		.then(tg.File.expect);
	let args = ["-c", script];
	return new CommandBuilder()
		.executable(executable)
		.args(args)
		.disallowUnset(true)
		.exitOnErr(true)
		.includeUtils(true);
}

class CommandBuilder {
	#args?: Array<tg.Unresolved<tg.Value>>;
	#checksum?: tg.Checksum | undefined;
	#disallowUnset: boolean;
	#env?: std.args.UnresolvedArgs<std.env.Arg>;
	#executable?: tg.Unresolved<tg.Artifact | undefined>;
	#exitOnErr: boolean;
	#includeUtils: boolean;
	#host?: string;
	#mounts?: Array<tg.Unresolved<string | tg.Template | tg.Command.Mount>>;
	#network?: boolean;
	#pipefail: boolean;

	constructor() {
		this.#disallowUnset = false;
		this.#exitOnErr = false;
		this.#includeUtils = false;
		this.#network = false;
		this.#pipefail = true;
	}

	args(...args: Array<tg.Unresolved<tg.Value>>): CommandBuilder {
		if (args.length > 0) {
			if (this.#args === undefined) {
				this.#args = [];
			}
			this.#args.push(...args);
		}
		return this;
	}

	async build(): Promise<tg.Value> {
		return await std.build(await this.command(), {
			checksum: this.#checksum,
			network: this.#network,
		});
	}

	checksum(checksum: tg.Checksum | undefined): CommandBuilder {
		this.#checksum = checksum;
		return this;
	}

	disallowUnset(bool: boolean): CommandBuilder {
		this.#disallowUnset = bool;
		return this;
	}

	env(...envArgs: std.args.UnresolvedArgs<std.env.Arg>): CommandBuilder {
		this.#env = std.flatten([this.#env, ...envArgs]);
		return this;
	}

	executable(executable: tg.Unresolved<tg.Artifact>): CommandBuilder {
		this.#executable = executable;
		return this;
	}

	exitOnErr(bool: boolean): CommandBuilder {
		this.#exitOnErr = bool;
		return this;
	}

	host(host: string): CommandBuilder {
		this.#host = host;
		return this;
	}

	includeUtils(bool: boolean): CommandBuilder {
		this.#includeUtils = bool;
		return this;
	}

	mount(
		m: tg.Unresolved<string | tg.Template | tg.Command.Mount>,
	): CommandBuilder {
		if (this.#mounts === undefined) {
			this.#mounts = [];
		}
		this.#mounts.push(m);
		return this;
	}

	network(bool: boolean): CommandBuilder {
		this.#network = bool;
		return this;
	}

	pipefail(bool: boolean): CommandBuilder {
		this.#pipefail = bool;
		return this;
	}

	async run(): Promise<tg.Value> {
		return await tg.run(this.command(), {
			checksum: this.#checksum,
			network: this.#network,
		});
	}

	async command(): Promise<tg.Command> {
		const arg: tg.Command.ArgObject = {};

		// Construct the executable.
		if (this.#executable !== undefined) {
			// If the user specified a custom executable, use that.
			arg.executable = await tg.resolve(this.#executable);
		} else {
			// Otherwise, use the default bash executable from the standard utils.
			arg.executable = await std.utils.bash
				.build({ sdk: false, env: std.sdk(), host: arg.host })
				.then((dir) => dir.get("bin/bash"))
				.then(tg.File.expect);
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
		if (this.#args !== undefined) {
			arg.args.push(
				...(await Promise.all(
					this.#args.map(async (a) => await tg.resolve(a)),
				)),
			);
		}

		// Construct the env.
		if (this.#includeUtils) {
			const utilsEnv = std.utils.env({
				sdk: false,
				env: std.sdk(),
				host: arg.host,
			});
			if (this.#env !== undefined) {
				arg.env = await std.env.arg(utilsEnv, this.#env);
			} else {
				arg.env = await utilsEnv;
			}
		} else {
			if (this.#env !== undefined) {
				arg.env = await std.env.arg(this.#env);
			}
		}

		// Set remaining fields.
		if (this.#host !== undefined) {
			arg.host = this.#host;
		} else {
			arg.host = await std.triple.host();
		}

		// Mounts
		if (this.#mounts !== undefined) {
			arg.mounts = await Promise.all(
				this.#mounts.map(async (m) => await tg.resolve(m)),
			);
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
export const command_ = async (
	...args: std.Args<tg.Command.Arg>
): Promise<tg.Command> => {
	const commandArg_ = await commandArg(...args);
	tg.assert(commandArg_, "spawn args must include a command");
	const orig = await tg.command(commandArg_);
	const mountArg = defaultMountArg(await orig.host());
	return tg.command(orig, mountArg);
};

/** Wrapper around tg.build that attaches the default mount to commands. */
export const build = async (
	...args: std.Args<tg.Process.SpawnArg>
): Promise<tg.Value> => {
	const { command: commandArg, ...arg } = await processArg(...args);
	tg.assert(commandArg, "spawn args must include a command");
	const command__ = await command_(commandArg);
	return tg.build(command__, arg);
};

/** Wrap a command with a default mount if the host is linux. For darwin, does not change the command. */
export const defaultMountArg = tg.command(
	async (host: string): Promise<tg.Command.Arg> => {
		const os = std.triple.os(host);
		if (os === "darwin") {
			return {};
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
			return {
				mounts: [await tg`${root}:/`],
			};
		} else {
			return tg.unreachable(`unexpected OS ${os}`);
		}
	},
);

/** Process a set of spawn args. */
export const processArg = async (
	...args: std.Args<tg.Process.SpawnArg>
): Promise<tg.Process.SpawnArgObject> => {
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
					host: await std.triple.host(),
				};
			} else if (arg instanceof tg.Command) {
				return { command: await arg.object() };
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

export const commandArg = async (
	...args: std.Args<tg.Command.Arg>
): Promise<tg.Command.ArgObject> => {
	let resolved = await Promise.all(args.map(tg.resolve));
	let flattened = std.flatten(resolved);
	let objects = await Promise.all(
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
					host: await std.triple.host(),
				};
			} else if (arg instanceof tg.Command) {
				return await arg.object();
			} else {
				return arg;
			}
		}),
	);
	let mutations = await createMutations(objects, {
		args: "append",
		env: "append",
	});
	let arg = await applyMutations(mutations);
	return arg;
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
