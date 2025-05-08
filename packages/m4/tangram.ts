import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/m4/",
	license: "GPL-3.0-or-later",
	name: "m4",
	repository: "https://git.savannah.gnu.org/cgit/m4.git",
	version: "1.4.19",
	provides: {
		binaries: ["m4"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:3be4a26d825ffdfda52a56fc43246456989a3630093cced3fbddf4771ee58a70";
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

export const build = async (...args: tg.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

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
			fortifySource: 2,
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
