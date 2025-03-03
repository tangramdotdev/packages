import * as ncurses from "ncurses" with { path: "../ncurses" };
import * as pkgConf from "pkgconf" with { path: "../pkgconf" };
import * as readline from "readline" with { path: "../readline" };
import * as std from "std" with { path: "../std" };
import * as zlib from "zlib" with { path: "../zlib" };

export const metadata = {
	homepage: "https://www.sqlite.org/",
	name: "sqlite",
	license: "https://sqlite.org/src/file?name=LICENSE.md&ci=trunk",
	repository: "https://www.sqlite.org/src/",
	version: "3.47.2",
	provides: {
		binaries: ["sqlite3"],
		headers: ["sqlite3.h"],
		libraries: ["sqlite3"],
	},
};

export const source = tg.command(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:f1b2ee412c28d7472bc95ba996368d6f0cdcf00362affdadb27ed286c179540b";
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
		pkgConf?: std.args.DependencyArg<pkgConf.Arg>;
		ncurses?: boolean | std.args.DependencyArg<ncurses.Arg>;
		readline?: boolean | std.args.DependencyArg<readline.Arg>;
		zlib?: boolean | std.args.DependencyArg<zlib.Arg>;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.command(async (...args: std.Args<Arg>) => {
	const defaultDependencies = {
		ncurses: false,
		readline: false,
		zlib: false,
	};
	const {
		autotools = {},
		build: build_,
		dependencies: dependencyArgs = {},
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>({ dependencies: defaultDependencies }, ...args);

	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const dependencies = [
		std.env.buildDependency(pkgConf.build, dependencyArgs.pkgConf),
	];
	if (dependencyArgs.ncurses !== undefined) {
		dependencies.push(
			std.env.runtimeDependency(ncurses.build, dependencyArgs.ncurses),
		);
	}
	if (dependencyArgs.readline !== undefined) {
		if (dependencyArgs.ncurses === undefined) {
			throw new Error("cannot enable readline without ncurses");
		}
		dependencies.push(
			std.env.runtimeDependency(readline.build, dependencyArgs.readline),
		);
	}
	if (dependencyArgs.zlib !== undefined) {
		dependencies.push(
			std.env.runtimeDependency(zlib.build, dependencyArgs.zlib),
		);
	}

	const env = std.env.arg(
		...dependencies.map((dep) =>
			std.env.envArgFromDependency(build, env_, host, sdk, dep),
		),
		env_,
	);

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

export const test = tg.command(async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
});
