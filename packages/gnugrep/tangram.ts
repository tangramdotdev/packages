import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/grep/",
	license: "GPL-2.0-or-later",
	name: "grep",
	repository: "https://git.savannah.gnu.org/cgit/grep.git",
	version: "3.7",
	provides: {
		binaries: ["grep"],
	},
};

export const source = tg.command(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:c22b0cf2d4f6bbe599c902387e8058990e1eee99aef333a203829e5fd3dbb342";
	return std.download.fromGnu({ name, version, checksum });
});

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.command(async (...args: std.Args<Arg>) => {
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
	const phases = { configure };

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
});

export default build;
export const test = tg.command(async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
});
