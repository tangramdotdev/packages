import * as std from "std" with { local: "../std" };
import patches from "./patches" with { type: "directory" };

export const metadata = {
	homepage: "https://gmplib.org",
	license: "LGPL-3.0-or-later",
	name: "gmp",
	version: "6.3.0",
	provides: {
		libraries: ["gmp"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:a3c2b80201b89e68616f4ad30bc66aee4927c3ce50e33929ca819d5c43538898";
	const extension = ".tar.xz";
	const base = `https://gmplib.org/download/${name}`;
	return await std.download
		.extractArchive({ base, checksum, extension, name, version })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap)
		.then((d) => std.patch(d, patches));
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
		env,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			doCheck: true,
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
