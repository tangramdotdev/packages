import * as gettext from "tg:gettext" with { path: "../gettext" };
import * as ncurses from "tg:ncurses" with { path: "../ncurses" };
import * as pkgconfig from "tg:pkgconfig" with { path: "../pkgconfig" };
import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://www.gnu.org/software/bash/",
	license: "GPL-3.0-or-later",
	name: "bash",
	repository: "https://git.savannah.gnu.org/git/bash.git",
	version: "5.2.21",
};

export let source = tg.target(async (arg?: Arg) => {
	let { name, version } = metadata;
	let build = arg?.build ?? (await std.triple.host());
	let env = std.env.arg(std.sdk({ host: build }, arg?.sdk), arg?.env);

	let checksum =
		"sha256:c8e31bdc59b69aaffc5b36509905ba3e5cbb12747091d27b4b977f078560d5b8";
	let source = std.download.fromGnu({ name, version, checksum });
	// See https://lists.gnu.org/archive/html/bug-bash/2022-10/msg00000.html
	// We don't have autoreconf available so we additionally manually resolve the configure script change. The m4 change isn't used, just here for completeness.
	// Once this fix is adopted upstream, we can remove this workaround.
	return await $`
		cp -R ${source} $OUTPUT
		chmod -R u+w $OUTPUT
		sed -i 's/if test $bash_cv_func_strtoimax = yes; then/if test $bash_cv_func_strtoimax = no; then/' $OUTPUT/m4/strtoimax.m4
		sed -i 's/if test $bash_cv_func_strtoimax = yes; then/if test $bash_cv_func_strtoimax = no ; then/' $OUTPUT/configure
	`
		.env(env)
		.host(std.triple.archAndOs(build))
		.then(tg.Directory.expect);
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		gettext?: gettext.Arg;
		ncurses?: ncurses.Arg;
		pkgconfig?: pkgconfig.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build: build_,
		dependencies: {
			gettext: gettextArg = {},
			ncurses: ncursesArg = {},
			pkgconfig: pkgconfigArg = {},
		} = {},
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let configure = {
		args: ["--without-bash-malloc", "--with-curses"],
	};
	let phases = { configure };

	let dependencies = [
		gettext.build(gettextArg),
		ncurses.build(ncursesArg),
		pkgconfig.build(pkgconfigArg),
	];
	let env = std.env.arg(...dependencies, env_);

	return std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			env: std.env.arg(env),
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

/** Wrap a shebang'd bash script to use this package's bach as the interpreter.. */
export let wrapScript = async (script: tg.File) => {
	let scriptMetadata = await std.file.executableMetadata(script);
	if (
		scriptMetadata?.format !== "shebang" ||
		!scriptMetadata.interpreter.includes("sh")
	) {
		throw new Error("Expected a shebang sh or bash script");
	}
	let interpreter = tg.File.expect(await (await build()).get("bin/bash"));
	return std.wrap(script, { interpreter, identity: "executable" });
};

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["bash"],
		metadata,
	});
	return true;
});
