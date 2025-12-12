import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.bytereef.org/mpdecimal/index.html",
	license: "Simplified BSD",
	name: "mpdecimal",
	version: "4.0.1",
	tag: "mpdecimal/4.0.1",
	provides: {
		headers: ["mpdecimal.h"],
		libraries: ["mpdec"],
	},
};

const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:96d33abb4bb0070c7be0fed4246cd38416188325f820468214471938545b1ac8";
	const base = `https://www.bytereef.org/software/mpdecimal/releases`;
	const extension = ".tar.gz";
	return std.download
		.extractArchive({
			checksum,
			base,
			name,
			version,
			extension,
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = std.autotools.Arg;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build({ source: source() }, ...args);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
