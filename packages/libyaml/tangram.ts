import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://pyyaml.org/wiki/LibYAML",
	license: "MIT",
	name: "libyaml",
	repository: "https://github.com/yaml/libyaml",
	version: "0.2.5",
};

export const source = tg.target(async () => {
	const { version } = metadata;
	const checksum =
		"sha256:c642ae9b75fee120b2d96c712538bd2cf283228d2337df2cf2988e3c02678ef4";
	const extension = ".tar.gz";
	const url = `https://github.com/yaml/libyaml/releases/download/${version}/yaml-${version}${extension}`;
	return await std
		.download({ url, checksum })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({ buildFn: default_, libraries: ["yaml"] });
	return true;
});
