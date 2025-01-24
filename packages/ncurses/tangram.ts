import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://invisible-island.net/ncurses/",
	license: "https://invisible-island.net/ncurses/ncurses-license.html",
	name: "ncurses",
	version: "6.5",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:136d91bc269a9a5785e5f9e980bc76ab57428f604ce3e5a5a90cebc767971cc6";
	return std.download.fromGnu({ name, version, checksum });
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

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

	// Patch curses.h to always use the wide-character ABI.
	const fixup = `sed -e 's/^#if.*XOPEN.*$/#if 1/' -i $OUTPUT/include/ncursesw/curses.h`;

	const phases = { configure, fixup };

	const env = std.env.arg(
		{
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

	// Create widechar-to-normal symlinks and fix pkgconfig files.
	await Promise.all(
		libNames.map(async (libName) => {
			const pc = tg.File.expect(
				await result.get(`lib/pkgconfig/${libName}w.pc`),
			);
			const content = await pc.text();
			let lines = content.split("\n");
			lines = lines.map((line) => {
				if (line.startsWith("Libs:")) {
					return line.replace("-L/output/output/lib", "-L${libdir}");
				} else {
					return line;
				}
			});
			result = await tg.directory(result, {
				lib: {
					[`lib${libName}.${dylibExt}`]: tg.symlink(
						`lib${libName}w.${dylibExt}`,
					),
					[`pkgconfig/${libName}w.pc`]: tg.file(lines.join("\n")),
					[`pkgconfig/${libName}.pc`]: tg.symlink(`./${libName}w.pc`),
				},
			});
		}),
	);

	// Add links from curses to ncurses.
	result = await tg.directory(result, {
		[`lib/libcurses.${dylibExt}`]: tg.symlink(`libncurses.${dylibExt}`),
		[`lib/pkgconfig/curses.pc`]: tg.symlink(`ncurses.pc`),
	});

	return result;
});

export default build;

export const test = tg.target(async () => {
	await std.assert.pkg({
		buildFn: build,
		libraries: ["formw", "menuw", "ncursesw", "panelw"],
		metadata,
	});
	return true;
});
