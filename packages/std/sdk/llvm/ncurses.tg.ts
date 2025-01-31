import * as std from "../../tangram.ts";

export const metadata = {
	homepage: "https://invisible-island.net/ncurses/",
	license: "https://invisible-island.net/ncurses/ncurses-license.html",
	name: "ncurses",
	version: "6.5",
};

export const source = tg.command(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:136d91bc269a9a5785e5f9e980bc76ab57428f604ce3e5a5a90cebc767971cc6";
	return std.download.fromGnu({ name, version, checksum });
});

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export const ncurses = tg.command(async (arg?: Arg) => {
	const {
		autotools = [],
		build: build_,
		env,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;
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
	const fixup = `sed -e 's/^#if.*XOPEN.*$/#if 1/' -i $OUTPUT/include/ncursesw/curses.h`;

	const phases = { configure, fixup };

	let result = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

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
});

export default ncurses;

export const test = tg.command(async () => {
	return await ncurses();
});
