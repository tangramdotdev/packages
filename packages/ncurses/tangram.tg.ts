import pkgconfig from "tg:pkgconfig" with { path: "../pkgconfig" };
import * as std from "tg:std" with { path: "../std" };

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
			"--with-termlib",
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

	let phases = { configure };

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
	let libNames = ["form", "menu", "ncurses", "ncurses++", "panel", "tinfo"];
	let dylibExt = os === "darwin" ? "dylib" : "so";

	// Create widechar-to-normal symlinks and fix pkgconfig files.
	await Promise.all(
		libNames.map(async (libName) => {
			let pc = tg.File.expect(await result.get(`lib/pkgconfig/${libName}w.pc`));
			let content = await pc.text();
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

	return result;
});

export default ncurses;

export let test = tg.target(async () => {
	let artifact = ncurses();
	await std.assert.pkg({
		buildFunction: ncurses,
		metadata,
	});
	return artifact;
});
