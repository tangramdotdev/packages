import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "coreutils",
	version: "9.4",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:ea613a4cf44612326e917201bbbcdfbd301de21ffc3b59b6e5c07e040b275e52";
	let source = await std.download.fromGnu({
		name,
		version,
		compressionFormat,
		checksum,
	});

	return source;
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: std.Triple.Arg;
	env?: std.env.Arg;
	host?: std.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let coreutils = tg.target(async (arg?: Arg) => {
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

export default coreutils;

export let test = tg.target(() => {
	return std.build(
		tg`
				echo "Checking that we can run coreutils." | tee $OUTPUT
				cat --version | tee -a $OUTPUT
				ls --version | tee -a $OUTPUT
				rm --version | tee -a $OUTPUT
			`,
		{ env: coreutils() },
	);
});
