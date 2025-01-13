import * as std from "./tangram.ts";

export function $(
	strings: TemplateStringsArray,
	...placeholders: std.args.UnresolvedArgs<tg.Template.Arg>
): Dollar {
	return new Dollar(strings, placeholders);
}

class Dollar {
	#args?: Array<tg.Value>;
	#checksum?: tg.Checksum | undefined;
	#disallowUnset: boolean;
	#env?: std.args.UnresolvedArgs<std.env.Arg>;
	#executable?: tg.Artifact | undefined;
	#exitOnErr: boolean;
	#includeUtils: boolean;
	#host?: string;
	#pipefail: boolean;
	#placeholders: std.args.UnresolvedArgs<tg.Template.Arg>;
	#strings: TemplateStringsArray;

	constructor(
		strings: TemplateStringsArray,
		...placeholders: std.args.UnresolvedArgs<tg.Template.Arg>
	) {
		this.#strings = strings;
		this.#placeholders = placeholders;
		this.#disallowUnset = true;
		this.#exitOnErr = true;
		this.#includeUtils = true;
		this.#pipefail = true;
	}

	checksum(checksum: tg.Checksum | undefined): Dollar {
		this.#checksum = checksum;
		return this;
	}

	disallowUnset(bool: boolean): Dollar {
		this.#disallowUnset = bool;
		return this;
	}

	env(...envArgs: std.args.UnresolvedArgs<std.env.Arg>): Dollar {
		this.#env = std.flatten([this.#env, ...envArgs]);
		return this;
	}

	executable(executable: tg.Artifact): Dollar {
		this.#executable = executable;
		return this;
	}
	
	exitOnErr(bool: boolean): Dollar {
		this.#exitOnErr = bool;
		return this;
	}

	host(host: string): Dollar {
		this.#host = host;
		return this;
	}

	includeUtils(bool: boolean): Dollar {
		this.#includeUtils = bool;
		return this;
	}

	async output(): Promise<tg.Value> {
		return await (await this.target()).output();
	}
	
	pipefail(bool: boolean): Dollar {
		this.#pipefail = bool;
		return this;
	}

	async target(): Promise<tg.Target> {
		const arg: tg.Target.ArgObject = {};

		// Construct the executable.
		if (this.#executable !== undefined) {
			// If the user specified a custom executable, use that.
			arg.executable = this.#executable;
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
		arg.args.push("-c");
		arg.args.push(await tg(this.#strings, ...std.flatten(this.#placeholders)));
		if (this.#args !== undefined) {
			arg.args.push(...this.#args);
		}

		// Construct the env.
		if (this.#includeUtils) {
			const utilsEnv = std.utils.env({ sdk: false, env: std.sdk(), host: arg.host });
			if (this.#env !== undefined) {
				arg.env = await std.env.arg(utilsEnv, this.#env);
			} else {
				arg.env = await utilsEnv;
			}
		} else {
			if (this.#env !== undefined) {
				arg.env = std.env.arg(this.#env);
			}
		}

		// Set remaining fields.
		if (this.#checksum !== undefined) {
			arg.checksum = this.#checksum;
		}
		if (this.#host !== undefined) {
			arg.host = this.#host;
		} else {
			arg.host = await std.triple.host();
		}
		return await tg.target(arg);
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
		return this.output().then(onfulfilled, onrejected);
	}
}

export const test = tg.target(async () => {
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
