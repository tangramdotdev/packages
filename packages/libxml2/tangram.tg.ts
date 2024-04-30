import * as std from "tg:std" with { path: "../std" };
import icu from "tg:icu" with { path: "../icu" };
import ncurses from "tg:ncurses" with { path: "../ncurses" };
import pkgconfig from "tg:pkgconfig" with { path: "../pkgconfig" };
import perl from "tg:perl" with { path: "../perl" };
import python from "tg:python" with { path: "../python" };
import readline from "tg:readline" with { path: "../readline" };
import xz from "tg:xz" with { path: "../xz" };
import zlib from "tg:zlib" with { path: "../zlib" };

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
	let outer = tg.Directory.expect(await std.download({ url, checksum }));
	return std.directory.unwrap(outer);
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let libxml2 = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

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
		icu({ ...rest, build, env: env_, host }),
		ncurses({ ...rest, build, env: env_, host }),
		perl({ ...rest, build, env: env_, host }),
		pkgconfig({ ...rest, build, env: env_, host }),
		python({ ...rest, build, env: env_, host }),
		readline({ ...rest, build, env: env_, host }),
		xz({ ...rest, build, env: env_, host }),
		zlib({ ...rest, build, env: env_, host }),
	];
	let env = [...deps, env_];

	return std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases: { prepare, configure },
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default libxml2;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: libxml2,
		binaries: ["xml2-config", "xmlcatalog", "xmllint"],
		libraries: ["xml2"],
	});
	return true;
});
