import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "ncurses",
	version: "6.4",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:6931283d9ac87c5073f30b6290c4c75f21632bb4fc3603ac8100812bed248159";
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
	let fixup =
		os === "linux"
			? `
				chmod -R u+w \${OUTPUT}
				for lib in ncurses form panel menu tinfo ; do
					rm -vf                     \${OUTPUT}/lib/lib\${lib}.so
					echo "INPUT(-l\${lib}w)" > \${OUTPUT}/lib/lib\${lib}.so
					ln -sfv \${lib}w.pc        \${OUTPUT}/lib/pkgconfig/\${lib}.pc
				done
				cd $OUTPUT
				rm -vf                     \${OUTPUT}/lib/libcursesw.so
				echo "INPUT(-lncursesw)" > \${OUTPUT}/lib/libcursesw.so
				ln -sfv libncurses.so      \${OUTPUT}/lib/libcurses.so
		`
			: "";
	let phases = { configure, fixup };

	return std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default ncurses;

export let test = tg.target(async () => {
	await std.assert.pkg({
		binaries: [
			"cleanr",
			"infocmp",
			"ncursesw6-config",
			"tabs",
			"tix",
			"tow",
			"tput",
			"tset",
		],
		buildFunction: ncurses,
		libraries: ["formw", "menuw", "ncursesw", "panelw", "tinfo"],
		metadata,
	});
	return ncurses();
});
