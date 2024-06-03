import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://sourceware.org/libffi/",
	license: "https://github.com/libffi/libffi/blob/master/LICENSE",
	name: "libffi",
	repository: "https://github.com/libffi/libffi",
	version: "3.4.6",
};

export let source = tg.target(async (): Promise<tg.Directory> => {
	let { name, version } = metadata;
	let checksum =
		"sha256:b0dea9df23c863a7a50e825440f3ebffabd65df1497108e5d437747843895a4e";
	let owner = name;
	let repo = name;
	let tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "release",
		tag,
		version,
	});
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = [],
		build,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-multi-os-directory",
			"--enable-portable-binary",
		],
	};

	return std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			phases: { configure },
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		libraries: ["ffi"],
	});
	return true;
});
