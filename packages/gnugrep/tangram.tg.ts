import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "grep",
	version: "3.7",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:c22b0cf2d4f6bbe599c902387e8058990e1eee99aef333a203829e5fd3dbb342";
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

export let gnugrep = tg.target(async (arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	let configure = {
		args: ["--disable-dependency-tracking"],
	};
	let phases = { configure };

	return std.autotools.build(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default gnugrep;

export let test = tg.target(async () => {
	await std.build(tg`
		echo "Checking that we can run grep." | tee $OUTPUT
		${gnugrep()}/bin/grep --version | tee -a $OUTPUT
	`);
	return true;
});
