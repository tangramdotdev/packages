import * as std from "tg:std" with { path: "../std" };
import * as icu from "tg:icu" with { path: "../icu" };
import * as ncurses from "tg:ncurses" with { path: "../ncurses" };
import * as pkgconfig from "tg:pkg-config" with { path: "../pkgconfig" };
import * as perl from "tg:perl" with { path: "../perl" };
import * as python from "tg:python" with { path: "../python" };
import * as readline from "tg:readline" with { path: "../readline" };
import * as xz from "tg:xz" with { path: "../xz" };
import * as zlib from "tg:zlib" with { path: "../zlib" };

export let metadata = {
	homepage: "https://gitlab.gnome.org/GNOME/libxml2/-/wikis/home",
	license: "https://gitlab.gnome.org/GNOME/libxml2/-/blob/master/Copyright",
	name: "libxml2",
	repository: "https://gitlab.gnome.org/GNOME/libxml2/-/tree/master",
	version: "2.12.6",
};

export let source = tg.target(async (): Promise<tg.Directory> => {
	let { name, version } = metadata;
	let checksum =
		"sha256:889c593a881a3db5fdd96cc9318c87df34eb648edfc458272ad46fd607353fbb";
	let packageArchive = std.download.packageArchive({
		name,
		version,
		extension: ".tar.xz",
	});
	let majorMinor = version.split(".").slice(0, 2).join(".");
	let url = `https://download.gnome.org/sources/${name}/${majorMinor}/${packageArchive}`;
	return await std
		.download({ url, checksum })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		icu?: icu.Arg;
		ncurses?: ncurses.Arg;
		perl?: perl.Arg;
		pkgconfig?: pkgconfig.Arg;
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

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		dependencies: {
			icu: icuArg = {},
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

	let prepare = "export LD_LIBRARY_PATH=$LIBRARY_PATH";
	let configure = {
		args: [
			"--disable-dependency-tracking",
			"--enable-static",
			"--enable-shared",
			"--with-history",
			"--with-icu",
		],
	};

	let deps = [
		icu.build(icuArg),
		ncurses.build(ncursesArg),
		perl.build(perlArg),
		pkgconfig.build(pkgconfigArg),
		python.toolchain(pythonArg),
		readline.build(readlineArg),
		xz.build(xzArg),
		zlib.build(zlibArg),
	];
	let env = [...deps, env_];

	return std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			env: std.env.arg(env),
			phases: { prepare, configure },
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["xml2-config", "xmlcatalog", "xmllint"],
		libraries: ["xml2"],
	});
	return true;
});
