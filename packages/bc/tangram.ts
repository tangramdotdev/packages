import * as std from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://github.com/gavinhoward/bc",
	name: "bc",
	license: "BSD-2-Clause",
	repository: "https://github.com/gavinhoward/bc",
	version: "7.0.3",
	tag: "bc/7.0.3",
	provides: {
		binaries: ["bc", "dc"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:91eb74caed0ee6655b669711a4f350c25579778694df248e28363318e03c7fc4";
	const tag = version;
	const owner = "gavinhoward";
	const repo = name;
	return await std.download
		.fromGithub({
			checksum,
			compression: "xz",
			owner,
			repo,
			tag,
			source: "release",
			version,
		})
		.then(tg.Directory.expect);
};

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const sourceDir = source_ ?? source();

	// Define phases
	const configure = {
		args: ["--disable-nls", "--opt=3"],
	};

	// Define environment.
	const ccCommand =
		std.triple.os(build) == "darwin" ? "cc -D_DARWIN_C_SOURCE" : "cc";
	const env = std.env.arg(
		{
			CC: tg.Mutation.setIfUnset(ccCommand),
			CFLAGS: tg.Mutation.suffix("-std=gnu17", " "),
		},
		env_,
	);

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
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
