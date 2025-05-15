import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/diffutils/",
	license: "GPL-3.0-or-later",
	name: "diffutils",
	repository: "https://git.savannah.gnu.org/cgit/diffutils.git",
	version: "3.12",
	provides: {
		binaries: ["cmp", "diff", "diff3"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:7c8b7f9fc8609141fdea9cece85249d308624391ff61dedaf528fcb337727dfd";
	return std.download.fromGnu({
		name,
		version,
		checksum,
		compression: "xz",
	});
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
