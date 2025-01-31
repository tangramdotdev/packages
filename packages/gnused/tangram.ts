import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/sed/",
	license: "GPL-2.0-or-later",
	name: "sed",
	repository: "https://git.savannah.gnu.org/cgit/sed.git",
	version: "4.9",
	provides: {
		binaries: ["sed"],
	},
};

export const source = tg.command(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:6e226b732e1cd739464ad6862bd1a1aba42d7982922da7a53519631d24975181";
	return std.download.fromGnu({
		name,
		version,
		checksum,
		compressionFormat: "xz",
	});
});

export type Arg = {
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
