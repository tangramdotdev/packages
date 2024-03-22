import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "sed",
	version: "4.8",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:53cf3e14c71f3a149f29d13a0da64120b3c1d3334fba39c4af3e520be053982a";
	return std.download.fromGnu({ name, version, checksum });
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let sed = tg.target(async (arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	let configure = {
		args: ["--disable-dependency-tracking"],
	};
	let phases = { configure };

	return std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			source: source_ ?? source(),
			phases,
		},
		autotools,
	);
});

export default sed;

export let test = tg.target(async () => {
	return std.build(tg`
		echo "Checking that we can run sed."
		${sed()}/bin/sed --version
	`);
});
