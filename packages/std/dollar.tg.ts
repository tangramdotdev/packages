import * as std from "./tangram.tg.ts";

export function $(
	strings: TemplateStringsArray,
	...placeholders: std.args.UnresolvedArgs<tg.Template.Arg>
): Dollar {
	return new Dollar(strings, placeholders);
}

class Dollar {
	#strings: TemplateStringsArray;
	#placeholders: std.args.UnresolvedArgs<tg.Template.Arg>;
	#host?: string;
	#executable?: tg.Artifact | undefined;
	#args?: Array<tg.Value>;
	#env?: std.args.UnresolvedArgs<std.env.Arg>;
	#lock?: tg.Lock | undefined;
	#checksum?: tg.Checksum | undefined;

	constructor(
		strings: TemplateStringsArray,
		...placeholders: std.args.UnresolvedArgs<tg.Template.Arg>
	) {
		this.#strings = strings;
		this.#placeholders = placeholders;
	}

	checksum(checksum: tg.Checksum | undefined): Dollar {
		this.#checksum = checksum;
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

	host(host: string): Dollar {
		this.#host = host;
		return this;
	}

	lock(lock: tg.Lock): Dollar {
		this.#lock = lock;
		return this;
	}

	async output(): Promise<tg.Value> {
		return await (await this.target()).output();
	}

	async target(): Promise<tg.Target> {
		let arg: tg.Target.ArgObject = {};
		if (this.#host !== undefined) {
			arg.host = this.#host;
		}
		// If the user specified a custom executable, use that.
		if (this.#executable !== undefined) {
			arg.executable = this.#executable;
		} else {
			// Otherwise, use the default bash executable from the standard utils.
			arg.executable = await std.utils.bash
				.build({ sdk: false, env: std.sdk(), host: arg.host })
				.then((dir) => dir.get("bin/bash"))
				.then(tg.File.expect);
		}
		// If we're using the default executable, add extra flags to make it more strict.
		let prefixArgs = this.#args ? [] : ["-euo", "pipefail"];
		arg.args = [
			...prefixArgs,
			"-c",
			await tg(this.#strings, ...std.flatten(this.#placeholders)),
		];
		if (this.#args !== undefined) {
			arg.args.push(...this.#args);
		}
		// Ensure the standard utils are provided in the env.
		let env_ = std.utils.env({ sdk: false, env: std.sdk(), host: arg.host });
		if (this.#env !== undefined) {
			arg.env = await std.env.arg(env_, this.#env);
		} else {
			arg.env = await env_;
		}
		if (this.#lock !== undefined) {
			arg.lock = this.#lock;
		}
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

export let test = tg.target(async () => {
	let f = tg.file("hello there!!!");
	let output = await $`cat ${f} > $OUTPUT
		echo $NAME >> $OUTPUT
		echo $TOOL >> $OUTPUT`
		.env({ NAME: "ben" })
		.env({ TOOL: "tangram" })
		.env({ NAME: tg.Mutation.suffix("L.", " ") })
		.then(tg.File.expect);
	return output;
});
