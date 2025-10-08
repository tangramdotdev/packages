import * as std from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/gawk/",
	name: "gawk",
	license: "GPL-3.0-or-later",
	repository: "https://git.savannah.gnu.org/git/gawk.git",
	version: "5.3.2",
	tag: "gawk/5.3.2",
	provides: {
		binaries: ["gawk"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:f8c3486509de705192138b00ef2c00bbbdd0e84c30d5c07d23fc73a9dc4cc9cc";
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
