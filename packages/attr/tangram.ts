import * as std from "std" with { local: "../std" };

import patches from "./patches" with { type: "directory" };

export const metadata = {
	homepage: "https://savannah.nongnu.org/projects/attr",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-2.0-or-later",
	name: "attr",
	repository: "https://git.savannah.nongnu.org/cgit/attr.git",
	version: "2.5.2",
	tag: "attr/2.5.2",
	provides: {
		binaries: ["attr", "getfattr", "setfattr"],
		headers: ["attr/attributes.h", "attr/error_context.h", "attr/libattr.h"],
		libraries: ["attr"],
	},
};

const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:f2e97b0ab7ce293681ab701915766190d607a1dba7fae8a718138150b700a70b";
	const base = `https://download.savannah.gnu.org/releases/${name}`;
	const extension = ".tar.xz";
	return std.download
		.extractArchive({ checksum, name, base, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap)
		.then((source) => std.patch(source, patches));
};

export type Arg = std.autotools.Arg;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{
			source: source(),
			phases: {
				configure: {
					args: [
						"--disable-dependency-tracking",
						"--disable-rpath",
						"--with-pic",
					],
				},
			},
		},
		...args,
	);
	std.assert.supportedHost(arg.host, metadata);
	return std.autotools.build(arg);
};

export default build;

export const test = async () => {
	const spec = {
		...metadata.provides,
		binaries: std.assert.allBinaries(metadata.provides.binaries, {
			testArgs: [],
			snapshot: "Usage:",
			exitOnErr: false,
		}),
		metadata,
	};
	return await std.assert.pkg(build, spec);
};
