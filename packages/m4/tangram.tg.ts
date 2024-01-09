import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "m4",
	version: "1.4.19",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:3be4a26d825ffdfda52a56fc43246456989a3630093cced3fbddf4771ee58a70";
	return std.download.fromGnu({ name, version, checksum });
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: std.Triple.Arg;
	env?: std.env.Arg;
	host?: std.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let m4 = tg.target(async (arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	return std.autotools.build(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default m4;

export let test = tg.target(async () => {
	return std.build(tg`
		echo "Checking that we can run m4."
		${m4()}/bin/m4 --version
	`);
});
