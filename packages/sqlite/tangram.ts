import * as ncurses from "tg:ncurses" with { path: "../ncurses" };
import * as pkgconfig from "tg:pkg-config" with { path: "../pkgconfig" };
import * as readline from "tg:readline" with { path: "../readline" };
import * as std from "tg:std" with { path: "../std" };
import * as zlib from "tg:zlib" with { path: "../zlib" };

export const metadata = {
	homepage: "https://www.sqlite.org/",
	name: "sqlite",
	license: "https://sqlite.org/src/file?name=LICENSE.md&ci=trunk",
	repository: "https://www.sqlite.org/src/",
	version: "3.46.1",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:67d3fe6d268e6eaddcae3727fce58fcc8e9c53869bdd07a0c61e38ddf2965071";
	const extension = ".tar.gz";

	const produceVersion = (version: string) => {
		const [major, minor, patch] = version.split(".");
		tg.assert(major);
		tg.assert(minor);
		tg.assert(patch);
		return `${major}${minor.padEnd(3, "0")}${patch.padEnd(3, "0")}`;
	};

	const packageName = `${name}-autoconf-${produceVersion(version)}`;
	const base = `https://www.sqlite.org/2024`;
	return std
		.download({ checksum, base, packageName, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		ncurses?: ncurses.Arg;
		readline?: readline.Arg;
		zlib?: zlib.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build: build_,
		dependencies: {
			ncurses: ncursesArg = {},
			readline: readlineArg = {},
			zlib: zlibArg = {},
		} = {},
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	// Set up default build dependencies.
	const buildDependencies = [];
	const pkgConfigForBuild = pkgconfig
		.build({ build, host: build })
		.then((d) => {
			return { PKGCONFIG: std.directory.keepSubdirectories(d, "bin") };
		});
	buildDependencies.push(pkgConfigForBuild);

	// Set up host dependencies.
	const hostDependencies = [];
	const ncursesForHost = await ncurses
		.build({ build, host, sdk }, ncursesArg)
		.then((d) => std.directory.keepSubdirectories(d, "include", "lib"));
	hostDependencies.push(ncursesForHost);
	const readlineForHost = await readline
		.build({ build, host, sdk }, readlineArg)
		.then((d) => std.directory.keepSubdirectories(d, "include", "lib"));
	hostDependencies.push(readlineForHost);
	const zlibForHost = await zlib
		.build({ build, host, sdk }, zlibArg)
		.then((d) => std.directory.keepSubdirectories(d, "include", "lib"));
	hostDependencies.push(zlibForHost);

	// Resolve env.
	let env = await std.env.arg(...buildDependencies, ...hostDependencies, env_);

	// Add final build dependencies to env.
	const resolvedBuildDependencies = [];
	const finalPkgConfig = await std.env.getArtifactByKey({
		env,
		key: "PKGCONFIG",
	});
	resolvedBuildDependencies.push(finalPkgConfig);
	env = await std.env.arg(env, ...resolvedBuildDependencies);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

export const test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["sqlite3"],
		libraries: ["sqlite3"],
		metadata,
	});
	return true;
});
