import * as std from "std" with { local: "../std" };
import patches from "./patches" with { type: "directory" };

export const metadata = {
	homepage: "https://gmplib.org",
	license: "LGPL-3.0-or-later",
	name: "gmp",
	version: "6.3.0",
	tag: "gmp/6.3.0",
	provides: {
		libraries: ["gmp"],
	},
};

const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:a3c2b80201b89e68616f4ad30bc66aee4927c3ce50e33929ca819d5c43538898";
	const extension = ".tar.xz";
	const base = `https://gmplib.org/download/${name}`;
	return std.download
		.extractArchive({ base, checksum, extension, name, version })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap)
		.then((d) => std.patch(d, patches));
};

export type Arg = std.autotools.Arg;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build({ source: source(), doCheck: true }, ...args);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
