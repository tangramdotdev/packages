import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/m4/",
	license: "GPL-3.0-or-later",
	name: "m4",
	repository: "https://git.savannah.gnu.org/cgit/m4.git",
	version: "1.4.19",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:3be4a26d825ffdfda52a56fc43246456989a3630093cced3fbddf4771ee58a70";
	return std.download.fromGnu({ name, version, checksum });
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

	const configure = {
		args: ["--disable-dependency-tracking"],
	};

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
});

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({ packageDir: default_(), binaries: ["m4"], metadata });
	return true;
});
