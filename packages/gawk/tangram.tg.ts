import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "gawk",
	version: "5.2.0",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:ef5af4449cb0269faf3af24bf4c02273d455f0741bf3c50f86ddc09332d6cf56";
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

export let gawk = tg.target(async (arg?: Arg) => {
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

export default gawk;

export let test = tg.target(() => {
	return std.build(
		tg`
		echo "Checking that we can run awk." | tee $OUTPUT
		awk --version | tee -a $OUTPUT
	`,
		{ env: gawk() },
	);
});
