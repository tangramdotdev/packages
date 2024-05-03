import * as std from "../../tangram.tg.ts";

export let metadata = {
	homepage: "https://invisible-island.net/ncurses/",
	license: "https://invisible-island.net/ncurses/ncurses-license.html",
	name: "ncurses",
	version: "6.5",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:136d91bc269a9a5785e5f9e980bc76ab57428f604ce3e5a5a90cebc767971cc6";
	return std.download.fromGnu({ name, version, checksum });
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let ncurses = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;
	let os = std.triple.os(host);

	let configure = {
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
	let fixup = `sed -e 's/^#if.*XOPEN.*$/#if 1/' -i $OUTPUT/include/ncursesw/curses.h`;

	let phases = { configure, fixup };

	let result = await std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);

	// Set libraries to post-process.
	let libNames = ["form", "menu", "ncurses", "ncurses++", "panel"];
	let dylibExt = os === "darwin" ? "dylib" : "so";

	// Create widechar-to-normal symlinks.
	for (let libName of libNames) {
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

export let test = tg.target(async () => {
	return await ncurses();
});
