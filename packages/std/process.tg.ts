import * as std from "./tangram.ts";
import { buildDefaultBash, defaultEnvArg } from "./command.tg.ts";

export function build(...args: std.Args<tg.Process.Arg>): StdProcessBuilder;
export function build(
	strings: TemplateStringsArray,
	...placeholders: std.Args<tg.Template.Arg>
): StdProcessBuilder;
export function build(...args: any): any {
	if (Array.isArray(args[0]) && "raw" in args[0]) {
		const strings = args[0] as TemplateStringsArray;
		const placeholders = args.slice(1);
		return new StdProcessBuilder("build", strings, placeholders);
	} else {
		return new StdProcessBuilder("build", undefined, undefined, args);
	}
}

export function run(...args: std.Args<tg.Process.Arg>): StdProcessBuilder;
export function run(
	strings: TemplateStringsArray,
	...placeholders: std.Args<tg.Template.Arg>
): StdProcessBuilder;
export function run(...args: any): any {
	if (Array.isArray(args[0]) && "raw" in args[0]) {
		const strings = args[0] as TemplateStringsArray;
		const placeholders = args.slice(1);
		return new StdProcessBuilder("run", strings, placeholders);
	} else {
		return new StdProcessBuilder("run", undefined, undefined, args);
	}
}

export const $ = run;

export function spawn(...args: std.Args<tg.Process.Arg>): StdProcessBuilder;
export function spawn(
	strings: TemplateStringsArray,
	...placeholders: std.Args<tg.Template.Arg>
): StdProcessBuilder;
export function spawn(...args: any): any {
	if (Array.isArray(args[0]) && "raw" in args[0]) {
		const strings = args[0] as TemplateStringsArray;
		const placeholders = args.slice(1);
		return new StdProcessBuilder("spawn", strings, placeholders);
	} else {
		return new StdProcessBuilder("spawn", undefined, undefined, args);
	}
}

type Mode = "build" | "run" | "spawn";

/** A thin wrapper over tg.Process.Builder that adds std-specific env handling and shell flags. */
export class StdProcessBuilder {
	#mode: Mode;
	#template: TemplateStringsArray | undefined;
	#placeholders: std.Args<tg.Template.Arg> | undefined;
	#passthrough: std.Args<tg.Process.Arg> | undefined;
	#envs: Array<tg.Unresolved<std.env.Arg>>;
	#bootstrap: boolean;
	#includeUtils: boolean;
	#exitOnErr: boolean;
	#disallowUnset: boolean;
	#pipefail: boolean;
	#name: tg.Unresolved<string | undefined> | undefined;
	#extra: Array<(b: tg.Process.Builder<any>) => tg.Process.Builder<any>>;
	#cwdExplicit: boolean;

	constructor(
		mode: Mode,
		template: TemplateStringsArray | undefined,
		placeholders: std.Args<tg.Template.Arg> | undefined,
		passthrough?: std.Args<tg.Process.Arg>,
	) {
		this.#mode = mode;
		this.#template = template;
		this.#placeholders = placeholders;
		this.#passthrough = passthrough;
		this.#envs = [];
		this.#bootstrap = false;
		this.#includeUtils = true;
		this.#exitOnErr = true;
		this.#disallowUnset = true;
		this.#pipefail = true;
		this.#name = undefined;
		this.#extra = [];
		this.#cwdExplicit = false;
	}

	/** Use raw /bin/sh. Skips std.utils auto-attach and pipefail (dash lacks pipefail). */
	bootstrap(b: boolean): this {
		this.#bootstrap = b;
		if (b) {
			this.#includeUtils = false;
			this.#pipefail = false;
		}
		return this;
	}

	/** Control whether utils are included in the default env. */
	includeUtils(b: boolean): this {
		this.#includeUtils = b;
		return this;
	}

	/** Control the -e shell flag. */
	exitOnErr(b: boolean): this {
		this.#exitOnErr = b;
		return this;
	}

	/** Control the -u shell flag. */
	disallowUnset(b: boolean): this {
		this.#disallowUnset = b;
		return this;
	}

	/** Control the -o pipefail shell flag. */
	pipefail(b: boolean): this {
		this.#pipefail = b;
		return this;
	}

	/** Add env. Accepts std.env.Arg (directories, artifacts, objects, etc.). */
	env(...envs: Array<tg.Unresolved<std.env.Arg>>): this {
		this.#envs.push(...envs);
		return this;
	}

	/** Set the process name. */
	named(name: tg.Unresolved<string | undefined>): this {
		this.#name = name;
		return this;
	}

	// Delegate remaining methods to tg.Process.Builder via deferred application.
	arg(...args: Array<tg.Unresolved<tg.Value>>): this {
		this.#extra.push((b) => b.arg(...args));
		return this;
	}

	args(...args: Array<tg.Unresolved<tg.MaybeMutation<Array<tg.Value>>>>): this {
		this.#extra.push((b) => b.args(...args));
		return this;
	}

	checksum(
		checksum: tg.Unresolved<tg.MaybeMutation<tg.Checksum | undefined>>,
	): this {
		this.#extra.push((b) => b.checksum(checksum));
		return this;
	}

	cwd(cwd: tg.Unresolved<tg.MaybeMutation<string | undefined>>): this {
		this.#cwdExplicit = true;
		this.#extra.push((b) => b.cwd(cwd));
		return this;
	}

	executable(
		executable: tg.Unresolved<tg.MaybeMutation<tg.Command.Arg.Executable>>,
	): this {
		this.#extra.push((b) => b.executable(executable));
		return this;
	}

	host(host: tg.Unresolved<tg.MaybeMutation<string>>): this {
		this.#extra.push((b) => b.host(host));
		return this;
	}

	network(network: tg.Unresolved<tg.MaybeMutation<boolean>>): this {
		this.#extra.push((b) => b.network(network));
		return this;
	}

	sandbox(
		sandbox: tg.Unresolved<
			tg.MaybeMutation<boolean | tg.Sandbox.Arg | tg.Sandbox.Id | undefined>
		>,
	): this {
		this.#extra.push((b) => b.sandbox(sandbox));
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
		const builder = await this.#resolve();
		const output = await builder;
		if (onfulfilled) {
			return onfulfilled(output as tg.Value);
		}
		return output as TResult1;
	}

	async #resolve(): Promise<tg.Process.Builder<any>> {
		const host = std.triple.host();
		let argObj: Record<string, tg.Value> = {};

		if (this.#template !== undefined) {
			// Template path: resolve shell, flags, env.
			let template = await tg.template(
				this.#template,
				...(this.#placeholders ?? []),
			);

			// Start in a per-process work subdir so $(pwd) isn't "/".
			if (!this.#cwdExplicit) {
				template = await tg.template`cd "$(mktemp -d)"\n${template}`;
			}

			// Build shell flags.
			const flags: Array<string> = [];
			if (this.#exitOnErr) flags.push("-e");
			if (this.#disallowUnset) flags.push("-u");
			if (this.#pipefail) flags.push("-o", "pipefail");

			if (this.#bootstrap) {
				argObj = {
					executable: "/bin/sh",
					args: [...flags, "-c", template],
					host,
				};
			} else {
				const shell = await buildDefaultBash(host);
				argObj = {
					executable: shell,
					args: [...flags, "-c", template],
					host,
				};
			}
		} else {
			// Non-template (arg object) path.
			if (!this.#bootstrap) {
				argObj = await defaultEnvArg();
			}
		}

		// Resolve user envs through std.env.arg for type compatibility.
		let envArgs: std.Args<std.env.Arg> = [];
		if (
			!this.#bootstrap &&
			this.#includeUtils &&
			this.#template !== undefined
		) {
			const utils = await tg
				.build(std.utils.env, { host, env: std.sdk() })
				.named("utils");
			envArgs.push(utils);
		}
		if (!this.#includeUtils) {
			envArgs.push({ utils: false });
		}
		if (this.#bootstrap && this.#template !== undefined) {
			envArgs.push(std.bootstrap.utils(host));
		}
		envArgs.push(...this.#envs);
		if (envArgs.length > 0) {
			const resolvedEnv = await std.env.arg(...envArgs);
			argObj.env = resolvedEnv;
		}

		// Create the tg.Process.Builder.
		let builder: tg.Process.Builder<any>;
		if (this.#passthrough !== undefined) {
			if (this.#mode === "build") {
				builder = tg.build(argObj, ...this.#passthrough);
			} else if (this.#mode === "run") {
				builder = tg.run(argObj, ...this.#passthrough);
			} else {
				builder = tg.spawn(argObj, ...this.#passthrough);
			}
		} else {
			if (this.#mode === "build") {
				builder = tg.build(argObj);
			} else if (this.#mode === "run") {
				builder = tg.run(argObj);
			} else {
				builder = tg.spawn(argObj);
			}
		}

		// Apply name.
		if (this.#name !== undefined) {
			builder = builder.named(this.#name);
		}

		// Apply deferred builder methods.
		for (const fn of this.#extra) {
			builder = fn(builder);
		}

		return builder;
	}
}

export const testBuild = async () => {
	const expected = tg.process.env.TANGRAM_HOST;
	const output = await build`echo $TANGRAM_HOST > ${tg.output}`.then(
		tg.File.expect,
	);
	const actual = (await output.text).trim();
	tg.assert(actual === expected, `expected ${actual} to equal ${expected}`);
	return true;
};

export const testBuildBootstrap = async () => {
	const expected = tg.process.env.TANGRAM_HOST;
	const output = await build`echo $TANGRAM_HOST > ${tg.output}`
		.bootstrap(true)
		.env({ SHELL: "/bin/sh" })
		.then(tg.File.expect);
	await output.store();
	console.log("OUTPUT", output.id);
	const actual = (await output.text).trim();
	tg.assert(actual === expected, `expected ${actual} to equal ${expected}`);
	return true;
};

/** Test the non-template `build` overload with a string executable path. */
export const testBuildNonTemplateString = async () => {
	const output = await build({
		executable: "/bin/sh",
		args: ["-c", tg`echo "hello" > ${tg.output}`],
	}).then(tg.File.expect);
	const actual = await output.text;
	const expected = "hello\n";
	tg.assert(actual === expected, `expected ${expected} but got ${actual}`);
	return true;
};

/** Test the non-template `build` overload with an artifact executable. */
export const testBuildNonTemplateArtifact = async () => {
	const bashDir = await std.utils.bash.build({ env: std.sdk() });
	const bashExe = await bashDir.get("bin/bash").then(tg.File.expect);
	const output = await build({
		executable: bashExe,
		args: ["-c", tg`echo "artifact" > ${tg.output}`],
	}).then(tg.File.expect);
	const actual = await output.text;
	const expected = "artifact\n";
	tg.assert(actual === expected, `expected ${expected} but got ${actual}`);
	return true;
};

/** Test the non-template `build` overload with an env containing an SDK. */
export const testBuildNonTemplateEnv = async () => {
	const env = await std.env.arg(std.sdk());
	const output = await build({
		executable: "/bin/sh",
		args: ["-c", tg`cc --version > ${tg.output}`],
		env,
	}).then(tg.File.expect);
	const actual = await output.text;
	tg.assert(actual.length > 0, "expected non-empty compiler version output");
	return true;
};

export const testBuildAll = async () => {
	await testBuild();
	await testBuildBootstrap();
	await testBuildNonTemplateString();
	await testBuildNonTemplateArtifact();
	await testBuildNonTemplateEnv();
	return true;
};

export const testDollar = async () => {
	const f = tg.file`hello there!!!\n`;
	const output = await $`cat ${f} > ${tg.output}
		echo $NAME >> ${tg.output}
		echo $TOOL >> ${tg.output}`
		.env({ NAME: "ben" })
		.env({ TOOL: "tangram" })
		.env({ NAME: tg.Mutation.suffix("L.", " ") })
		.then(tg.File.expect);
	const actual = await output.text;
	const expected = "hello there!!!\nben L.\ntangram\n";
	tg.assert(actual === expected, `expected ${actual} to equal ${expected}`);
	return true;
};

export const testDollarBootstrap = async () => {
	const f = tg.file`hello there!!!\n`;
	const utils = std.bootstrap.sdk.prepareBootstrapUtils();
	const output = await $`cat ${f} > ${tg.output}
		echo $NAME >> ${tg.output}
		echo $TOOL >> ${tg.output}`
		.bootstrap(true)
		.env({ NAME: "ben" })
		.env({ TOOL: "tangram" })
		.env({ NAME: tg.Mutation.suffix("L.", " ") })
		.env(utils)
		.then(tg.File.expect);
	const actual = await output.text;
	const expected = "hello there!!!\nben L.\ntangram\n";
	tg.assert(actual === expected, `expected ${actual} to equal ${expected}`);
	return true;
};

/** Test the non-template `run` overload with a string executable path. */
export const testRunNonTemplateString = async () => {
	const output = await run({
		executable: "/bin/sh",
		args: ["-c", tg`echo "hello" > ${tg.output}`],
	}).then(tg.File.expect);
	const actual = await output.text;
	const expected = "hello\n";
	tg.assert(actual === expected, `expected ${expected} but got ${actual}`);
	return true;
};

/** Test the non-template `run` overload with an artifact executable. */
export const testRunNonTemplateArtifact = async () => {
	const bashDir = await std.utils.bash.build({ env: std.sdk() });
	const bashExe = await bashDir.get("bin/bash").then(tg.File.expect);
	const output = await run({
		executable: bashExe,
		args: ["-c", tg`echo "artifact" > ${tg.output}`],
	}).then(tg.File.expect);
	const actual = await output.text;
	const expected = "artifact\n";
	tg.assert(actual === expected, `expected ${expected} but got ${actual}`);
	return true;
};

/** Test the non-template `run` overload with an env containing an SDK. */
export const testRunNonTemplateEnv = async () => {
	const env = await std.env.arg(std.sdk());
	const output = await run({
		executable: "/bin/sh",
		args: ["-c", tg`cc --version > ${tg.output}`],
		env,
	}).then(tg.File.expect);
	const actual = await output.text;
	tg.assert(actual.length > 0, "expected non-empty compiler version output");
	return true;
};

export const testEnvClear = async () => {
	const output = await $`/usr/bin/env > ${tg.output}`
		.bootstrap(true)
		.env({ FOO: "foo!" })
		.env({ BAR: "bar!" })
		.env(tg.Mutation.set({ BAZ: "baz!" }))
		.then(tg.File.expect);
	const actual = await output.text;
	console.log("actual", actual);
	tg.assert(actual.includes("baz!"), "expected output to contain `baz!`");
	tg.assert(!actual.includes("foo!"), "expected output to not contain `foo!`");
	return true;
};

export const testRunAll = async () => {
	await testDollar();
	await testDollarBootstrap();
	await testRunNonTemplateString();
	await testRunNonTemplateArtifact();
	await testRunNonTemplateEnv();
	await testEnvClear();
	return true;
};
