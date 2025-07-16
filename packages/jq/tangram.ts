import * as std from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://jqlang.github.io/jq/",
	name: "jq",
	license: "https://github.com/jqlang/jq?tab=License-1-ov-file#readme",
	repository: "https://github.com/jqlang/jq",
	version: "1.8.1",
	provides: {
		binaries: ["jq"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:2be64e7129cecb11d5906290eba10af694fb9e3e7f9fc208a311dc33ca837eb0";
	const extension = ".tar.gz";
	const base = `https://github.com/stedolan/${name}/releases/download/${name}-${version}`;
	return await std.download
		.extractArchive({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = {
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

	const configure = {
		args: ["--without-oniguruma", "--disable-maintainer-mode"],
	};

	const phases = { configure };

	const env = std.env.arg(
		{
			CFLAGS: tg.Mutation.suffix("-std=gnu17", " "),
		},
		env_,
	);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
