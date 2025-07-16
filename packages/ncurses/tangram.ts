import * as std from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://invisible-island.net/ncurses/",
	license: "https://invisible-island.net/ncurses/ncurses-license.html",
	name: "ncurses",
	version: "6.5",
	provides: {
		// FIXME all of this is broken.
		// binaries: [
		// "clear",
		// "infocmp",
		// "ncursesw6-config",
		// "tabs",
		// "tic",
		// "toe",
		// "tput",
		// "tset",
		// ],
		// headers: [
		// "ncursesw/curses.h",
		// "ncursesw/cursesapp.h",
		// "ncursesw/cursesf.h",
		// "ncursesw/cursesm.h",
		// "ncursesw/cursesp.h",
		// "ncursesw/cursesw.h",
		// "ncursesw/cursslk.h",
		// "ncursesw/eti.h",
		// "ncursesw/etip.h",
		// "ncursesw/form.h",
		// "ncursesw/menu.h",
		// "ncursesw/ncurses_dll.h",
		// "ncursesw/panel.h",
		// "ncursesw/term.h",
		// "ncursesw/term_entry.h",
		// "ncursesw/termcap.h",
		// "ncursesw/unctrl.h",
		// ],
		// FIXME ncurses++w
		libraries: ["formw", "menuw", "ncursesw", "panelw"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:136d91bc269a9a5785e5f9e980bc76ab57428f604ce3e5a5a90cebc767971cc6";
	return std.download.fromGnu({ name, version, checksum });
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const os = std.triple.os(host);

	const configure = {
		args: [
			"--with-shared",
			"--with-cxx-shared",
			"--enable-widec",
			"--without-debug",
			"--enable-pc-files",
			`--with-pkg-config-libdir="$OUTPUT/lib/pkgconfig"`,
			"--enable-symlinks",
			"--disable-home-terminfo",
			"--disable-rpath-hack",
			"--without-manpages",
		],
	};
	if (os === "darwin") {
		configure.args.push("--disable-stripping"); // prevent calling xcrun. compiling -with `-Wl,-s` makes this unnecessary anyway.
	}

	if (build !== host) {
		// When cross-compiling, we cannot use the just-compiled `tic` executable built for the host to generate the database on the build machine.
		configure.args.push("--disable-database", "--with-fallbacks");
	}

	// Patch curses.h to always use the wide-character ABI.
	const fixup = `sed -e 's/^#if.*XOPEN.*$/#if 1/' -i $OUTPUT/include/ncursesw/curses.h`;

	const phases = { configure, fixup };

	const env = std.env.arg(
		{
			CFLAGS: tg.Mutation.suffix("-std=gnu17", " "),
			// We rename the shared objects after the build, let the LD proxy ignore missing libraries.
			TANGRAM_LINKER_ALLOW_MISSING_LIBRARIES: true,
		},
		env_,
	);

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

	// Create widechar symlinks and fix pkgconfig files.
	for await (const libName of libNames) {
		const pc = tg.File.expect(await result.get(`lib/pkgconfig/${libName}w.pc`));
		const content = await pc.text();
		let lines = content.split("\n");
		lines = lines.map((line) => {
			if (line.startsWith("Libs:")) {
				// Replace library paths with the libdir.
				return line.replace(/-L(\/\S+)/g, "-L${libdir}");
			} else if (line.startsWith("Cflags:")) {
				// Strip include paths besides the `-I${includedir}` line.
				return line
					.split(/\s+/)
					.filter(
						(part) => !part.startsWith("-I") || part === "-I${includedir}",
					)
					.join(" ");
			} else {
				return line;
			}
		});
		result = await tg.directory(result, {
			[`lib/lib${libName}.${dylibExt}`]: tg.symlink(
				`lib${libName}w.${dylibExt}`,
			),
			[`lib/pkgconfig/${libName}w.pc`]: tg.file(lines.join("\n")),
			[`lib/pkgconfig/${libName}.pc`]: tg.symlink(`${libName}w.pc`),
		});
	}

	// Add links from curses to ncurses.
	result = await tg.directory(result, {
		[`lib/libcurses.${dylibExt}`]: tg.symlink(`libncurses.${dylibExt}`),
		[`lib/pkgconfig/curses.pc`]: tg.symlink(`ncurses.pc`),
	});

	return result;
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
