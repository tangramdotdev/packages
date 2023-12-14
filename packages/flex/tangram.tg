import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "flex",
	version: "2.6.4",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:e87aae032bf07c26f85ac0ed3250998c37621d95f8bd748b31f15b33c45ee995";
	let unpackFormat = ".tar.gz" as const;
	let url = `https://github.com/westes/${name}/releases/download/v${version}/${name}-${version}${unpackFormat}`;
	let download = tg.Directory.expect(
		await std.download({
			checksum,
			unpackFormat,
			url,
		}),
	);
	return std.directory.unwrap(download);
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: std.Triple.Arg;
	env?: std.env.Arg;
	host?: std.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let flex = tg.target(async (arg?: Arg) => {
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

export default flex;

export let test = tg.target(() => {
	return std.build(tg`
		echo "Checking that we can run flex." | tee $OUTPUT
		${flex()}/bin/flex --version | tee -a $OUTPUT
	`);
});
