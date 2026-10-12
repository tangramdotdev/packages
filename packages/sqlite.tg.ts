import * as ncurses from "ncurses" with { source: "./ncurses.tg.ts" };
import * as readline from "readline" with { source: "./readline.tg.ts" };
import * as std from "std" with { source: "./std" };
import * as zlib from "zlib-ng" with { source: "./zlib-ng.tg.ts" };

export const metadata = {
	homepage: "https://www.sqlite.org/",
	name: "sqlite",
	license: "https://sqlite.org/src/file?name=LICENSE.md&ci=trunk",
	repository: "https://www.sqlite.org/src/",
	version: "3.54.0",
	tag: "sqlite/3.54.0",
	provides: {
		binaries: ["sqlite3"],
		headers: ["sqlite3.h"],
		libraries: ["sqlite3"],
	},
};

export async function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:134ec0802dda5795816e25d25872d20b312cb3973438c49b30bc40b7705ea9ed";
	const extension = ".tar.gz";

	function produceVersion(version: string) {
		const [major, minor, patch] = version.split(".");
		tg.assert(major);
		tg.assert(minor);
		tg.assert(patch);
		return `${major}${minor.padEnd(3, "0")}${patch.padEnd(3, "0")}`;
	}

	const packageName = `${name}-autoconf-${produceVersion(version)}`;
	const base = `https://www.sqlite.org/2026`;
	return std.download
		.extractArchive({ checksum, base, packageName, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export function deps() {
	return std.deps({
		ncurses: ncurses.build,
		readline: readline.build,
		zlib: zlib.build,
	});
}

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export function build(...args: tg.Args<Arg>) {
	return std.autotools.build({ source: source(), deps }, ...args);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
