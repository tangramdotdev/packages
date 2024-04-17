import ncurses from "tg:ncurses" with { path: "../ncurses" };
import pkgconfig from "tg:pkgconfig" with { path: "../pkgconfig" };
import readline from "tg:readline" with { path: "../readline" };
import * as std from "tg:std" with { path: "../std" };
import zlib from "tg:zlib" with { path: "../zlib" };

export let metadata = {
	homepage: "https://www.sqlite.org/",
	name: "sqlite",
	license: "https://sqlite.org/src/file?name=LICENSE.md&ci=trunk",
	repository: "https://www.sqlite.org/src/",
	version: "3.45.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:bc9067442eedf3dd39989b5c5cfbfff37ae66cc9c99274e0c3052dc4d4a8f6ae";
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

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let sqlite = tg.target((arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let dependencies = [ncurses(arg), pkgconfig(arg), readline(arg), zlib(arg)];
	let env = [...dependencies, env_];

	return std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default sqlite;

export let test = tg.target(async () => {
	let directory = sqlite();
	await std.assert.pkg({
		directory,
		binaries: ["sqlite3"],
		libraries: ["sqlite3"],
		metadata,
	});
	return directory;
});
