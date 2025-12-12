import * as std from "../../tangram.ts";

export const metadata = {
	homepage: "https://invisible-island.net/ncurses/",
	license: "https://invisible-island.net/ncurses/ncurses-license.html",
	name: "ncurses",
	version: "6.5",
	tag: "ncurses/6.5",
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:136d91bc269a9a5785e5f9e980bc76ab57428f604ce3e5a5a90cebc767971cc6";
	return std.download.fromGnu({ name, version, checksum });
};

type Arg = Omit<std.autotools.Arg, "deps"> & {
	bootstrap?: boolean;
};

export const ncurses = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg({ source: source() }, ...args);
	const {
		bootstrap = false,
		build,
		env,
		host,
		sdk,
		source: source_,
		...autotoolsRest
	} = arg;
	const os = std.triple.os(host);

	const configure = {
		args: [
			"--with-shared",
			"--with-cxx-shared",
			"--enable-widec",
			"--without-debug",
			"--enable-symlinks",
			"--disable-home-terminfo",
			"--disable-rpath-hack",
			"--without-manpages",
		],
	};
	if (os === "darwin") {
		configure.args.push("--disable-stripping"); // prevent calling xcrun. compiling -with `-Wl,-s` makes this unnecessary anyway.
	}

	// Patch curses.h to always use the wide-character ABI.
	const fixup = tg`sed -e 's/^#if.*XOPEN.*$/#if 1/' -i ${tg.output}/include/ncursesw/curses.h`;

	const phases = { configure, fixup };

	let result = await std.autotools.build({
		...arg,
		...autotoolsRest,
		bootstrap,
		env,
		phases,
		source: source_,
	});

	// Set libraries to post-process.
	const libNames = ["form", "menu", "ncurses", "ncurses++", "panel"];
	const dylibExt = os === "darwin" ? "dylib" : "so";

	// Create widechar-to-normal symlinks.
	for (const libName of libNames) {
		result = await tg.directory(result, {
			lib: {
				[`lib${libName}.${dylibExt}`]: tg.symlink(`lib${libName}w.${dylibExt}`),
			},
		});
	}

	// Add links from curses to ncurses.
	result = await tg.directory(result, {
		[`lib/libcurses.${dylibExt}`]: tg.symlink(`libncurses.${dylibExt}`),
	});

	return result;
};

export default ncurses;

export const test = async () => {
	return await ncurses();
};
