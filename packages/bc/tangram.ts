import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://git.gavinhoward.com/gavin/bc",
	name: "bc",
	license: "BSD-2-Clause",
	repository: "https://git.gavinhoward.com/gavin/bc",
	version: "7.0.3",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const checksum =
		"sha256:91eb74caed0ee6655b669711a4f350c25579778694df248e28363318e03c7fc4";
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

export const build = tg.target(async (...args: std.Args<Arg>) => {
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

export default build;

export const provides = {
	binaries: ["bc", "dc"],
};

export const test = tg.target(async () => {
	const spec = std.assert.defaultSpec(provides, metadata);
	return await std.assert.pkg(build, spec);
});
