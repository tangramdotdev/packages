import * as rust from "tg:rust" with { path: "../rust" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "rust-test",
	version: "0.0.0",
};

export let source = tg.target(async () => {
	return tg.Directory.expect(await tg.include("./hello"));
});

type Arg = {
	build?: std.Triple.Arg;
	env?: std.env.Arg;
	rust?: tg.MaybeNestedArray<rust.Arg>;
	source?: tg.Directory;
	host?: std.Triple.Arg;
};

export let rustTest = tg.target(async (arg?: Arg) => {
	let {
		build,
		host,
		rust: rustArgs = [],
		source: source_,
		...rest
	} = arg ?? {};

	return rust.build(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			source: source_ ?? source(),
		},
		rustArgs,
	);
});

export default rustTest;

export let test = tg.target(async () => {
	await tg.build(tg`
		echo "Checking that we can run the program."
		${rustTest()}/bin/hello
	`);

	return true;
});
