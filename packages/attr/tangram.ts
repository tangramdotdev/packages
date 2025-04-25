import * as std from "std" with { path: "../std" };

import patches from "./patches" with { type: "directory" };

export const metadata = {
	homepage: "https://savannah.nongnu.org/projects/attr",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-2.0-or-later",
	name: "attr",
	repository: "https://git.savannah.nongnu.org/cgit/attr.git",
	version: "2.5.2",
	provides: {
		binaries: ["attr", "getfattr", "setfattr"],
		headers: ["attr/attributes.h", "attr/error_context.h", "attr/libattr.h"],
		libraries: ["attr"],
	},
};

export const source = tg.command(async () => {
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
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	std.assert.supportedHost(host, metadata);

	const configure = {
		args: ["--disable-dependency-tracking", "--disable-rpath", "--with-pic"],
	};
	const phases = { configure };

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

const provides = {
	binaries: ["attr", "getfattr", "setfattr"],
	headers: ["attr/attributes.h", "attr/error_context.h", "attr/libattr.h"],
	libraries: ["attr"],
};

export const test = tg.command(async () => {
	const displaysUsage = (name: string) => {
		return {
			name,
			testArgs: [],
			testPredicate: (stdout: string) => stdout.includes("Usage:"),
		};
	};
	const spec = {
		...provides,
		binaries: provides.binaries.map(displaysUsage),
		metadata,
	};
	return await std.assert.pkg(build, spec);
});
