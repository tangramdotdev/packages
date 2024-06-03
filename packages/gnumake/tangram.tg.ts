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
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	return std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			env,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export let test = tg.target(() => {
	return std.build(tg`
		mkdir -p $OUTPUT
		echo "Checking that we can run GNU Make.
		${build()}/bin/make --version
	`);
});
