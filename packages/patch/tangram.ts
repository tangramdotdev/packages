import * as std from "std" with { path: "../std" };
import patches from "./patches" with { type: "directory" };

export const metadata = {
	homepage: "https://savannah.gnu.org/projects/patch/",
	license: "GPL-3.0-or-later",
	name: "patch",
	repository: "https://git.savannah.gnu.org/cgit/patch.git",
	version: "2.7.6",
	provides: {
		binaries: ["patch"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:f87cee69eec2b4fcbf60a396b030ad6aa3415f192aa5f7ee84cad5e11f7f5ae3";
	return std.download
		.fromGnu({ name, version, checksum })
		.then((source) => std.patch(source, patches));
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
		env,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
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
