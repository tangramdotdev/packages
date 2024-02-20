import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "findutils",
	version: "4.9.0",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:a2bfb8c09d436770edc59f50fa483e785b161a3b7b9d547573cb08065fd462fe";
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

export let findutils = tg.target(async (arg?: Arg) => {
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

export default findutils;

export let test = tg.target(() => {
	return std.build(
		`
			echo "Checking that we can run findutils." | tee $OUTPUT
			find --version | tee -a $OUTPUT
			locate --version | tee -a $OUTPUT
			updatedb --version | tee -a $OUTPUT
			xargs --version | tee -a $OUTPUT
		`,
		{ env: findutils() },
	);
});
