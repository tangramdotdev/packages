import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "libffi",
	version: "3.4.6",
};

export let source = tg.target(async (): Promise<tg.Directory> => {
	let { name, version } = metadata;
	let checksum =
		"sha256:b0dea9df23c863a7a50e825440f3ebffabd65df1497108e5d437747843895a4e";
	let unpackFormat = ".tar.gz" as const;
	let url = `https://github.com/${name}/${name}/releases/download/v${version}/${name}-${version}${unpackFormat}`;
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

export let libffi = tg.target(async (arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	let configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-multi-os-directory",
			"--enable-portable-binary",
		],
	};

	return std.autotools.build(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			phases: { configure },
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default libffi;

export let test = tg.target(async () => {
	let directory = libffi();
	await std.assert.pkg({
		directory,
		libs: ["ffi"],
	});
	return directory;
});
