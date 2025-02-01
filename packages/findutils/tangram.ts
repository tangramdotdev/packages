import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/findutils/",
	name: "findutils",
	license: "GPL-3.0-or-later",
	repository: "https://git.savannah.gnu.org/cgit/findutils.git",
	version: "4.10.0",
	provides: {
		binaries: ["find", "locate", "updatedb", "xargs"],
	},
};

export const source = tg.command(() => {
	const { name, version } = metadata;
	const compressionFormat = "xz";
	const checksum =
		"sha256:1387e0b67ff247d2abde998f90dfbf70c1491391a59ddfecb8ae698789f0a4f5";
	return std.download.fromGnu({ name, version, checksum, compressionFormat });
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

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
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
