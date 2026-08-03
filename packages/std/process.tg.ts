import * as std from "./tangram.ts";
import { envMapper, shBootstrap, stdArgs } from "./command.tg.ts";

/** A `tg.Process.Builder` whose env accepts `std.env.Arg`. */
export type ProcessBuilder<
	M extends tg.Process.Builder.Mode,
	A extends Array<tg.Value> = Array<tg.Value>,
	O extends tg.Value = tg.Value,
> = tg.Process.Builder<M, A, O, std.env.Arg>;

/** The overloads of `tg.build`, `tg.run`, and `tg.spawn`, with the env widened to `std.env.Arg`. */
export type ProcessBuilderFactory<M extends tg.Process.Builder.Mode> = {
	<A extends tg.UnresolvedArgs<Array<tg.Value>>, O extends tg.ReturnValue>(
		function_: (...args: A) => O,
	): ProcessBuilder<M, [], tg.ResolvedReturnValue<O>>;
	<A extends tg.UnresolvedArgs<Array<tg.Value>>, O extends tg.ReturnValue>(
		function_: (...args: A) => O,
		...args: tg.UnresolvedArgs<tg.ResolvedArgs<A>>
	): ProcessBuilder<M, [], tg.ResolvedReturnValue<O>>;
	(
		strings: TemplateStringsArray,
		...placeholders: tg.Args<tg.Template.Arg>
	): ProcessBuilder<M>;
	(...args: tg.Args<tg.Process.Arg>): ProcessBuilder<M>;
};

/** `tg.build` plus the std env and the env mapper. */
export const build: ProcessBuilderFactory<"run"> = (...args: any): any =>
	tg.build(...stdArgs(args)).envMapper(envMapper);

/** `tg.run` plus the std env and the env mapper. */
export const run: ProcessBuilderFactory<"run"> = (...args: any): any =>
	tg.run(...stdArgs(args)).envMapper(envMapper);

/** `tg.spawn` plus the std env and the env mapper. */
export const spawn: ProcessBuilderFactory<"spawn"> = (...args: any): any =>
	tg.spawn(...stdArgs(args)).envMapper(envMapper);

export const $ = run;

export async function testBuildAll() {
	await testBuildArgs();
	await testBuildTemplate();
	return true;
}

/** Test the arg form, which passes through to tg untouched. */
export async function testBuildArgs() {
	const output = await build({
		executable: "/bin/sh",
		args: ["-c", tg`echo "hello" > ${tg.output}`],
		host: tg.host.current,
	}).then(tg.File.expect);
	const actual = await output.text;
	const expected = "hello\n";
	tg.assert(actual === expected, `expected ${expected} but got ${actual}`);
	return true;
}

/** Test the template form, which runs under std's shell. */
export async function testBuildTemplate() {
	const output = await build`echo "template" > ${tg.output}`.then(
		tg.File.expect,
	);
	const actual = await output.text;
	const expected = "template\n";
	tg.assert(actual === expected, `expected ${expected} but got ${actual}`);
	return true;
}

export async function testRunAll() {
	await testDollar();
	await testDollarBootstrap();
	await testEnvClear();
	return true;
}

export async function testDollar() {
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
}

export async function testDollarBootstrap() {
	const f = tg.file`hello there!!!\n`;
	const output = await $(shBootstrap`cat ${f} > ${tg.output}
		echo $NAME >> ${tg.output}
		echo $TOOL >> ${tg.output}`)
		.env({ NAME: "ben" })
		.env({ TOOL: "tangram" })
		.env({ NAME: tg.Mutation.suffix("L.", " ") })
		.then(tg.File.expect);
	const actual = await output.text;
	const expected = "hello there!!!\nben L.\ntangram\n";
	tg.assert(actual === expected, `expected ${actual} to equal ${expected}`);
	return true;
}

/** Test that a top-level mutation clears the accumulated env. */
export async function testEnvClear() {
	const output = await $(shBootstrap`/usr/bin/env > ${tg.output}`)
		.env({ FOO: "foo!" })
		.env({ BAR: "bar!" })
		.env(tg.Mutation.set({ BAZ: "baz!" }))
		.then(tg.File.expect);
	const actual = await output.text;
	tg.assert(actual.includes("baz!"), "expected output to contain `baz!`");
	tg.assert(!actual.includes("foo!"), "expected output to not contain `foo!`");
	return true;
}
