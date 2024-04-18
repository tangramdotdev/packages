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
	let outer = tg.Directory.expect(await std.download({ url, checksum }));
	return std.directory.unwrap(outer);
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let bc = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};

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
	let env = [{ CC: tg.Mutation.setIfUnset(ccCommand) }, env_];

	let output = std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			buildInTree: true,
			env,
			opt: "3",
			phases: { configure },
			source: sourceDir,
		},
		autotools,
	);

	return output;
});

export default bc;

export let test = tg.target(async () => {
	let directory = bc();
	await std.assert.pkg({
		directory,
		binaries: ["bc"],
		metadata,
	});
	return directory;
});
