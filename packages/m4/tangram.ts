import * as std from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/m4/",
	license: "GPL-3.0-or-later",
	name: "m4",
	repository: "https://git.savannah.gnu.org/cgit/m4.git",
	version: "1.4.20",
	provides: {
		binaries: ["m4"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:6ac4fc31ce440debe63987c2ebbf9d7b6634e67a7c3279257dc7361de8bdb3ef";
	return std.download.fromGnu({ name, version, checksum });
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
		args: ["--disable-dependency-tracking"],
	};

	const env = std.env.arg(
		{ CFLAGS: tg.Mutation.suffix("-std=gnu17", " ") },
		env_,
	);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases: { configure },
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
