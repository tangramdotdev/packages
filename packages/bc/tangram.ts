import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://git.gavinhoward.com/gavin/bc",
	name: "bc",
	license: "BSD-2-Clause",
	repository: "https://git.gavinhoward.com/gavin/bc",
	version: "6.7.5",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const checksum =
		"sha256:c3e02c948d51f3ca9cdb23e011050d2d3a48226c581e0749ed7cbac413ce5461";
	const base = `https://git.gavinhoward.com/gavin/${name}/releases/download/${version}`;
	return await std
		.download({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

type Arg = {
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
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const sourceDir = source_ ?? source();

	// Define phases
	const configure = {
		args: ["--disable-nls", "--opt=3"],
	};

	// Define environment.
	const ccCommand =
		std.triple.os(build) == "darwin" ? "cc -D_DARWIN_C_SOURCE" : "cc";
	const env = std.env.arg({ CC: tg.Mutation.setIfUnset(ccCommand) }, env_);

	const output = std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			buildInTree: true,
			env,
			opt: "3",
			phases: { configure },
			sdk,
			source: sourceDir,
		},
		autotools,
	);

	return output;
});

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({ buildFn: default_, binaries: ["bc"], metadata });
	return true;
});
