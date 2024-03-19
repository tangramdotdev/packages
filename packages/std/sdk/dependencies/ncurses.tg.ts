import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.tg.ts";
import pkgconfig from "./pkg_config.tg.ts";

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

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};

	let host = host_ ? tg.triple(host_) : await tg.Triple.host();
	let build = build_ ? tg.triple(build_) : host;

	let configure = {
		args: [
			"--with-shared",
			"--with-cxx-shared",
			"--without-debug",
			"--enable-widec",
			"--enable-pc-files",
			`--with-pkg-config-libdir="$OUTPUT/lib/pkgconfig"`,
			"--enable-symlinks",
			"--disable-database",
			"--disable-home-terminfo",
			"--disable-rpath-hack",
			"--enable-termcap",
			"--without-manpages",
		],
	};

	let fixup = `
				chmod -R u+w \${OUTPUT}
				for lib in ncurses form panel menu ; do
					rm -vf                     \${OUTPUT}/lib/lib\${lib}.so
					echo "INPUT(-l\${lib}w)" > \${OUTPUT}/lib/lib\${lib}.so
					ln -sfv \${lib}w.pc        \${OUTPUT}/lib/pkgconfig/\${lib}.pc
				done
				cd $OUTPUT
				rm -vf                     \${OUTPUT}/lib/libcursesw.so
				echo "INPUT(-lncursesw)" > \${OUTPUT}/lib/libcursesw.so
				ln -sfv libncurses.so      \${OUTPUT}/lib/libcurses.so
		`;
	let phases = { configure, fixup };

	let env = [env_, std.utils.env(arg), pkgconfig(arg)];

	return std.autotools.build(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			env,
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

export let test = tg.target(async () => {
	let host = bootstrap.toolchainTriple(await tg.Triple.host());
	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });
	let directory = build({ host, bootstrapMode, env: sdk });
	await std.assert.pkg({
		bootstrapMode,
		directory,
		libs: ["ncursesw", "formw", "menuw", "panelw"],
		metadata,
	});
	return directory;
});
