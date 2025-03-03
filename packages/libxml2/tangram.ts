import * as std from "std" with { path: "../std" };
import * as ncurses from "ncurses" with { path: "../ncurses" };
import * as pkgConfig from "pkgconf" with { path: "../pkgconf" };
import * as perl from "perl" with { path: "../perl" };
import * as python from "python" with { path: "../python" };
import * as readline from "readline" with { path: "../readline" };
import * as xz from "xz" with { path: "../xz" };
import * as zlib from "zlib" with { path: "../zlib" };

export const metadata = {
	homepage: "https://gitlab.gnome.org/GNOME/libxml2/-/wikis/home",
	license: "https://gitlab.gnome.org/GNOME/libxml2/-/blob/master/Copyright",
	name: "libxml2",
	repository: "https://gitlab.gnome.org/GNOME/libxml2/-/tree/master",
	version: "2.13.5",
	provides: {
		binaries: ["xml2-config", "xmlcatalog", "xmllint"],
		libraries: ["xml2"],
	},
};

export const source = tg.command(async (): Promise<tg.Directory> => {
	const { name, version } = metadata;
	const checksum =
		"sha256:74fc163217a3964257d3be39af943e08861263c4231f9ef5b496b6f6d4c7b2b6";
	const extension = ".tar.xz";
	const majorMinor = version.split(".").slice(0, 2).join(".");
	const base = `https://download.gnome.org/sources/${name}/${majorMinor}`;
	return await std
		.download({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		ncurses?: ncurses.Arg;
		perl?: perl.Arg;
		pkgconfig?: pkgConfig.Arg;
		python?: python.Arg;
		readline?: readline.Arg;
		xz?: xz.Arg;
		zlib?: zlib.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.command(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: {
			ncurses: ncursesArg = {},
			perl: perlArg = {},
			pkgconfig: pkgconfigArg = {},
			python: pythonArg = {},
			readline: readlineArg = {},
			xz: xzArg = {},
			zlib: zlibArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const configure = {
		args: [
			"--disable-dependency-tracking",
			"--enable-static",
			"--enable-shared",
			"--with-history",
		],
	};

	const phases = { configure };

	const pythonArtifact = python.self(pythonArg);
	const deps = [
		ncurses.build({ build, env: env_, host, sdk }, ncursesArg),
		perl.build({ build, host: build }, perlArg),
		pkgConfig.build({ build, host: build }, pkgconfigArg),
		pythonArtifact,
		readline.build({ build, env: env_, host, sdk }, readlineArg),
		xz.build({ build, env: env_, host, sdk }, xzArg),
		zlib.build({ build, env: env_, host, sdk }, zlibArg),
	];
	const env = [
		...deps,
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
			env: std.env.arg(env),
			phases,
			sdk,
			setRuntimeLibraryPath: true,
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
