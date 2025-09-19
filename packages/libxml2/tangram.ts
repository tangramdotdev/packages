import * as std from "std" with { local: "../std" };
import * as ncurses from "ncurses" with { local: "../ncurses" };
import * as python from "python" with { local: "../python" };
import * as readline from "readline" with { local: "../readline" };
import * as xz from "xz" with { local: "../xz" };
import * as zlib from "zlib" with { local: "../zlib" };

export const metadata = {
	homepage: "https://gitlab.gnome.org/GNOME/libxml2/-/wikis/home",
	license: "https://gitlab.gnome.org/GNOME/libxml2/-/blob/master/Copyright",
	name: "libxml2",
	repository: "https://gitlab.gnome.org/GNOME/libxml2/-/tree/master",
	version: "2.14.5",
	provides: {
		binaries: ["xml2-config", "xmlcatalog", "xmllint"],
		libraries: ["xml2"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:03d006f3537616833c16c53addcdc32a0eb20e55443cba4038307e3fa7d8d44b";
	const extension = ".tar.xz";
	const majorMinor = version.split(".").slice(0, 2).join(".");
	const base = `https://download.gnome.org/sources/${name}/${majorMinor}`;
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		ncurses?: std.args.DependencyArg<ncurses.Arg>;
		readline?: std.args.DependencyArg<readline.Arg>;
		xz?: std.args.DependencyArg<xz.Arg>;
		zlib?: std.args.DependencyArg<zlib.Arg>;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: dependencyArgs = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const configure = {
		args: [
			"--disable-dependency-tracking",
			"--enable-static",
			"--enable-shared",
			"--with-history",
		],
	};

	const phases = { configure };

	const processDependency = (dep: any) =>
		std.env.envArgFromDependency(build, env_, host, sdk, dep);

	const pythonArtifact = processDependency(
		std.env.buildDependency(python.self),
	);
	const deps = [
		std.env.runtimeDependency(ncurses.build, dependencyArgs.ncurses),
		std.env.runtimeDependency(readline.build, dependencyArgs.readline),
		std.env.runtimeDependency(xz.build, dependencyArgs.xz),
		std.env.runtimeDependency(zlib.build, dependencyArgs.zlib),
	];
	const env = [
		...deps.map(processDependency),
		pythonArtifact,
		{
			CPATH: tg.Mutation.suffix(
				tg`${pythonArtifact}/include/python${python.versionString()}`,
				":",
			),
		},
		env_,
	];

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(...env),
			phases,
			sdk,
			setRuntimeLibraryPath: true,
			source: source_ ?? source(),
		},
		autotools,
	);
};

export default build;

export const test = async () => {
	const outputIncludes = (
		name: string,
		includes: string,
		args?: Array<string>,
	) => {
		return {
			name,
			testArgs: args ?? ["--version"],
			testPredicate: (stdout: string) =>
				stdout.toLowerCase().includes(includes),
		};
	};
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: [
			"xml2-config",
			outputIncludes("xmlcatalog", "catalogs cleanup", ["--verbose"]),
			outputIncludes("xmllint", "21401"),
		],
	};
	return await std.assert.pkg(build, spec);
};
