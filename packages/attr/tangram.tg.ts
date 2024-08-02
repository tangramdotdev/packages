import * as std from "tg:std" with { path: "../std" };

import patches from "./patches" with { type: "directory" };

export let metadata = {
	homepage: "https://savannah.nongnu.org/projects/attr",
	license: "GPL-2.0-or-later",
	name: "attr",
	repository: "https://git.savannah.nongnu.org/cgit/attr.git",
	version: "2.5.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:f2e97b0ab7ce293681ab701915766190d607a1dba7fae8a718138150b700a70b";
	let base = `https://mirrors.sarata.com/non-gnu/${name}`;
	let extension = ".tar.xz";
	return std
		.download({ checksum, name, base, version, extension })
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

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let configure = {
		args: ["--disable-dependency-tracking", "--disable-rpath", "--with-pic"],
	};
	let phases = { configure };

	let output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	// Remove .la files.
	for await (let [name, _] of await output
		.get("lib")
		.then(tg.Directory.expect)) {
		if (name.endsWith(".la")) {
			output = await tg.directory(output, { [`lib/${name}`]: undefined });
		}
	}

	return output;
});

export default build;

export let test = tg.target(async () => {
	let binTest = (name: string) => {
		return {
			name,
			testArgs: [],
			testPredicate: (stdout: string) => stdout.includes("Usage:"),
		};
	};
	let binaries = ["attr", "getfattr", "setfattr"].map(binTest);

	await std.assert.pkg({
		binaries,
		buildFunction: build,
		libraries: ["attr"],
		metadata,
	});
	return true;
});
