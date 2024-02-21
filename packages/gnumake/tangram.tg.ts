import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "make",
	version: "4.3",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:e05fdde47c5f7ca45cb697e973894ff4f5d79e13b750ed57d7b66d8defc78e19";
	return std.download.fromGnu({ name, version, checksum });
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: tg.Triple.Arg;
	env?: std.env.Arg;
	host?: tg.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let make = tg.target(async (arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	return std.autotools.build(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default make;

export let test = tg.target(() => {
	return std.build(tg`
		mkdir -p $OUTPUT
		echo "Checking that we can run GNU Make.
		${make()}/bin/make --version
	`);
});
