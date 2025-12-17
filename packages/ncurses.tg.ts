import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://invisible-island.net/ncurses/",
	license: "https://invisible-island.net/ncurses/ncurses-license.html",
	name: "ncurses",
	version: "6.5",
	tag: "ncurses/6.5",
	provides: {
		headers: [
			"ncursesw/curses.h",
			"ncursesw/eti.h",
			"ncursesw/form.h",
			"ncursesw/menu.h",
			"ncursesw/ncurses_dll.h",
			"ncursesw/panel.h",
			"ncursesw/term.h",
			"ncursesw/term_entry.h",
			"ncursesw/termcap.h",
			"ncursesw/unctrl.h",
		],
		libraries: ["formw", "menuw", "ncursesw", "panelw"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:136d91bc269a9a5785e5f9e980bc76ab57428f604ce3e5a5a90cebc767971cc6";
	return std.download.fromGnu({ name, version, checksum });
};

export type Arg = std.autotools.Arg;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{
			source: source(),
			env: {
				CFLAGS: tg.Mutation.suffix("-std=gnu17", " "),
				// We rename the shared objects after the build, let the LD proxy ignore missing libraries.
				TGLD_ALLOW_MISSING_LIBRARIES: true,
			},
			phases: {
				configure: {
					args: [
						"--with-shared",
						"--with-cxx-shared",
						"--enable-widec",
						"--without-debug",
						"--enable-pc-files",
						tg`--with-pkg-config-libdir="${tg.output}/lib/pkgconfig"`,
						"--enable-symlinks",
						"--disable-home-terminfo",
						"--disable-rpath-hack",
						"--without-manpages",
					],
				},
				// Patch curses.h to always use the wide-character ABI.
				fixup: tg`sed -e 's/^#if.*XOPEN.*$/#if 1/' -i ${tg.output}/include/ncursesw/curses.h`,
			},
		},
		...args,
	);

	const os = std.triple.os(arg.host);
	const configureArgs: Array<string> = [];

	if (os === "darwin") {
		// Prevent calling xcrun. Compiling with `-Wl,-s` makes this unnecessary anyway.
		configureArgs.push("--disable-stripping");
	}
	if (arg.build !== arg.host) {
		// When cross-compiling, we cannot use the just-compiled `tic` executable built for the host to generate the database on the build machine.
		configureArgs.push("--disable-database", "--with-fallbacks");
	}

	let phases = arg.phases;
	if (configureArgs.length > 0) {
		phases = await std.phases.arg(phases, {
			configure: { args: configureArgs },
		});
	}

	let output = await std.autotools.build({ ...arg, phases });

	// Postprocess: create widechar symlinks and fix pkgconfig files.
	const libNames = ["form", "menu", "ncurses", "ncurses++", "panel"];
	const dylibExt = os === "darwin" ? "dylib" : "so";

	for (const libName of libNames) {
		const pc = tg.File.expect(await output.get(`lib/pkgconfig/${libName}w.pc`));
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
		output = await tg.directory(output, {
			[`lib/lib${libName}.${dylibExt}`]: tg.symlink(
				`lib${libName}w.${dylibExt}`,
			),
			[`lib/pkgconfig/${libName}w.pc`]: tg.file(lines.join("\n")),
			[`lib/pkgconfig/${libName}.pc`]: tg.symlink(`${libName}w.pc`),
		});
	}

	// Add links from curses to ncurses.
	output = await tg.directory(output, {
		[`lib/libcurses.${dylibExt}`]: tg.symlink(`libncurses.${dylibExt}`),
		[`lib/pkgconfig/curses.pc`]: tg.symlink(`ncurses.pc`),
	});

	return output;
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
