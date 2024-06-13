import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://git.gavinhoward.com/gavin/bc",
	name: "bc",
	license: "BSD-2-Clause",
	repository: "https://git.gavinhoward.com/gavin/bc",
	version: "6.7.5",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let extension = ".tar.xz";
	let packageName = std.download.packageArchive({
		extension,
		name,
		version,
	});
	let checksum =
		"sha256:c3e02c948d51f3ca9cdb23e011050d2d3a48226c581e0749ed7cbac413ce5461";
	let url = `https://git.gavinhoward.com/gavin/${name}/releases/download/${version}/${packageName}`;
	return await std
		.download({ url, checksum })
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

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let sourceDir = source_ ?? source();

	// Define phases
	let configure = {
		args: ["--disable-nls", "--opt=3"],
	};

	// Define environment.
	let ccCommand =
		std.triple.os(build) == "darwin" ? "cc -D_DARWIN_C_SOURCE" : "cc";
	let env = std.env.arg({ CC: tg.Mutation.setIfUnset(ccCommand) }, env_);

	let output = std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
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

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["bc"],
		metadata,
	});
	return true;
});
