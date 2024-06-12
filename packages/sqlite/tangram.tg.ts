import * as ncurses from "tg:ncurses" with { path: "../ncurses" };
import * as pkgconfig from "tg:pkg-config" with { path: "../pkgconfig" };
import * as readline from "tg:readline" with { path: "../readline" };
import * as std from "tg:std" with { path: "../std" };
import * as zlib from "tg:zlib" with { path: "../zlib" };

export let metadata = {
	homepage: "https://www.sqlite.org/",
	name: "sqlite",
	license: "https://sqlite.org/src/file?name=LICENSE.md&ci=trunk",
	repository: "https://www.sqlite.org/src/",
	version: "3.46.0",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:6f8e6a7b335273748816f9b3b62bbdc372a889de8782d7f048c653a447417a7d";
	let extension = ".tar.gz";

	let produceVersion = (version: string) => {
		let [major, minor, patch] = version.split(".");
		tg.assert(major);
		tg.assert(minor);
		tg.assert(patch);
		return `${major}${minor.padEnd(3, "0")}${patch.padEnd(3, "0")}`;
	};

	let pkgName = `${name}-autoconf-${produceVersion(version)}`;
	let url = `https://www.sqlite.org/2024/${pkgName}${extension}`;
	let download = tg.Directory.expect(await std.download({ checksum, url }));
	return std.directory.unwrap(download);
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		ncurses?: ncurses.Arg;
		pkgconfig?: pkgconfig.Arg;
		readline?: readline.Arg;
		zlib?: zlib.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build: build_,
		dependencies: {
			ncurses: ncursesArg = {},
			pkgconfig: pkgconfigArg = {},
			readline: readlineArg = {},
			zlib: zlibArg = {},
		} = {},
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let dependencies = [
		ncurses.build(ncursesArg),
		pkgconfig.build(pkgconfigArg),
		readline.build(readlineArg),
		zlib.build(zlibArg),
	];
	let env = [...dependencies, env_];

	return std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			env: std.env.arg(env),
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["sqlite3"],
		libraries: ["sqlite3"],
		metadata,
	});
	return true;
});
