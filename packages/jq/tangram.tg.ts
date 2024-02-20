import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "jq",
	version: "1.7",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:402a0d6975d946e6f4e484d1a84320414a0ff8eb6cf49d2c11d144d4d344db62";
	let unpackFormat = ".tar.gz" as const;
	let url = `https://github.com/stedolan/${name}/releases/download/${name}-${version}/${name}-${version}${unpackFormat}`;
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
	build?: tg.Triple.Arg;
	env?: std.env.Arg;
	host?: tg.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};
export let jq = tg.target(async (arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	let configure = {
		args: ["--without-oniguruma", "--disable-maintainer-mode"],
	};
	let phases = { configure };

	return std.autotools.build(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			source: source_ ?? source(),
			phases,
		},
		autotools,
	);
});

export let test = tg.target(async () => {
	return std.build(tg`
		echo "Checking that we can run jq." | tee $OUTPUT
		${jq()}/bin/jq --version | tee -a $OUTPUT
	`);
});

export default jq;
