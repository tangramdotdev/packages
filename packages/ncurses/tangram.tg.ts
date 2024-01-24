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
	build?: std.Triple.Arg;
	env?: std.env.Arg;
	host?: std.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let ncurses = tg.target(async (arg?: Arg) => {
	let { autotools = [], build: build_, host: host_, source: source_, ...rest } = arg ?? {};
	let host = host_ ? std.triple(host_) : await std.Triple.host();
	let build = build_ ? std.triple(build_) : host;

	let configure = {
		args: ["--with-shared", "--with-cxx-shared", "--enable-widec"],
	};
	let install = tg.Mutation.set("make DESTDIR=${OUTPUT} install.includes install.libs"); // skip progs/terminfo data/man pages
	let fixup = (host.os === "linux") ? `
				chmod -R u+w \${OUTPUT}
				for lib in ncurses form panel menu ; do
					rm -vf                     \${OUTPUT}/lib/lib\${lib}.so
					echo "INPUT(-l\${lib}w)" > \${OUTPUT}/lib/lib\${lib}.so
				done
				cd $OUTPUT
				rm -vf                     \${OUTPUT}/lib/libcursesw.so
				echo "INPUT(-lncursesw)" > \${OUTPUT}/lib/libcursesw.so
				ln -sfv libncurses.so      \${OUTPUT}/lib/libcurses.so
		` : "";
	let phases = { configure, install, fixup };

	return std.autotools.build(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default ncurses;

export let test = tg.target(async () => {
	let source = tg.directory({
		["main.c"]: tg.file(`
			#include <stdio.h>
			int main () {}
		`),
	});

	return std.build(
		tg`
			set -x
			env
			echo "Checking if we can link against libcurses."
			cc -v ${source}/main.c -o $OUTPUT -lncurses
		`,
		{ env: [std.sdk(), ncurses()] },
	);
});
