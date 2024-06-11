import * as std from "./tangram.tg.ts";

export function $(
	strings: TemplateStringsArray,
	...placeholders: std.Args<tg.Template.Arg>
): Dollar {
	return new Dollar(strings, placeholders);
}

class Dollar {
	strings: TemplateStringsArray;
	placeholders: std.Args<tg.Template.Arg>;
	host?: string;
	executable?: tg.Artifact | undefined;
	args?: Array<tg.Value>;
	env_?: { [key: string]: tg.Value };
	lock?: tg.Lock | undefined;
	checksum?: tg.Checksum | undefined;

	constructor(
		strings: TemplateStringsArray,
		...placeholders: std.Args<tg.Template.Arg>
	) {
		this.strings = strings;
		this.placeholders = placeholders;
	}

	env(): Dollar {
		return this;
	}

	async output(): Promise<tg.Value> {
		let arg: tg.Target.ArgObject = {};
		if (this.host !== undefined) {
			arg.host = this.host;
		}
		if (this.executable !== undefined) {
			arg.executable = this.executable;
		} else {
			arg.executable = await tg.symlink({ path: tg.path("/bin/sh") });
		}
		arg.args = ["-c", await tg(this.strings, this.placeholders)];
		if (this.args !== undefined) {
			arg.args.push(...this.args);
		}
		if (this.env_ !== undefined) {
			arg.env = this.env_;
		}
		if (this.lock !== undefined) {
			arg.lock = this.lock;
		}
		if (this.checksum !== undefined) {
			arg.checksum = this.checksum;
		}
		if (this.host !== undefined) {
			arg.host = this.host;
		} else {
			arg.host = await std.triple.host();
		}
		return await (await tg.target(arg)).output();
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
	let output = await $`echo 'hi from dollar' > $OUTPUT`;
	return output;
});
