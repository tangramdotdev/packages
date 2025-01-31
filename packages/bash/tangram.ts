import * as gettext from "gettext" with { path: "../gettext" };
import * as libiconv from "libiconv" with { path: "../libiconv" };
import * as ncurses from "ncurses" with { path: "../ncurses" };
import * as pkgConfig from "pkgconf" with { path: "../pkgconf" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/bash/",
	license: "GPL-3.0-or-later",
	name: "bash",
	repository: "https://git.savannah.gnu.org/git/bash.git",
	version: "5.2.37",
	provides: {
		// FIXME bashbug
		// binaries: ["bash", "bashbug"],
		binaries: ["bash"],
		// headers: [
		// 	"bash/alias.h",
		// 	"bash/array.h",
		// 	"bash/arrayfunc.h",
		// 	"bash/assoc.h",
		// 	"bash/bashansi.h",
		// 	"bash/bashintl.h",
		// 	"bash/bashjmp.h",
		// 	"bash/bashtypes.h",
		// 	"bash/builtins/bashgetopt.h",
		// 	"bash/builtins/builtext.h",
		// 	"bash/builtins/common.h",
		// 	"bash/builtins/getopt.h",
		// 	"bash/builtins.h",
		// 	"bash/command.h",
		// 	"bash/config-bot.h",
		// 	"bash/config-top.h",
		// 	"bash/config.h",
		// 	"bash/conftypes.h",
		// 	"bash/dispose_cmd.h",
		// 	"bash/error.h",
		// 	"bash/execute_cmd.h",
		// 	"bash/externs.h",
		// 	"bash/general.h",
		// 	"bash/hashlib.h",
		// 	"bash/include/ansi_stdlib.h",
		// 	"bash/include/chartypes.h",
		// 	"bash/include/filecntl.h",
		// 	"bash/include/gettext.h",
		// 	"bash/include/maxpath.h",
		// 	"bash/include/memalloc.h",
		// 	"bash/include/ocache.h",
		// 	"bash/include/posixdir.h",
		// 	"bash/include/posixjmp.h",
		// 	"bash/include/posixstat.h",
		// 	"bash/include/posixtime.h",
		// 	"bash/include/posixwait.h",
		// 	"bash/include/shmbchar.h",
		// 	"bash/include/shmbutil.h",
		// 	"bash/include/shtty.h",
		// 	"bash/include/stat-time.h",
		// 	"bash/include/stdc.h",
		// 	"bash/include/systimes.h",
		// 	"bash/include/typemax.h",
		// 	"bash/include/unionwait.h",
		// 	"bash/jobs.h",
		// 	"bash/make_cmd.h",
		// 	"bash/pathnames.h",
		// 	"bash/quit.h",
		// 	"bash/shell.h",
		// 	"bash/sig.h",
		// 	"bash/siglist.h",
		// 	"bash/signames.h",
		// 	"bash/subst.h",
		// 	"bash/syntax.h",
		// 	"bash/unwind_prot.h",
		// 	"bash/variables.h",
		// 	"bash/version.h",
		// 	"bash/xmalloc.h",
		// 	"bash/y.tab.h",
		// ],
	},
};

export const source = tg.command(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:9599b22ecd1d5787ad7d3b7bf0c59f312b3396d1e281175dd1f8a4014da621ff";
	return std.download.fromGnu({ name, version, checksum });
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		libiconv?: std.args.DependencyArg<libiconv.Arg>;
		ncurses?: std.args.DependencyArg<ncurses.Arg>;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.command(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: dependencyArgs = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const dependencies = [
		std.env.buildDependency(pkgConfig.build),
		std.env.buildDependency(gettext.build), // TODO optional.
		std.env.runtimeDependency(libiconv.build, dependencyArgs.libiconv),
		std.env.runtimeDependency(ncurses.build, dependencyArgs.ncurses),
	];

	// Resolve env.
	const env = std.env.arg(
		...dependencies.map((dep) =>
			std.env.envArgFromDependency(build, env_, host, sdk, dep),
		),
		env_,
	);

	const configure = {
		args: ["--without-bash-malloc", "--with-curses"],
	};
	const phases = { configure };

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

/** Wrap a shebang'd bash script to use this package's bach as the interpreter.. */
export const wrapScript = async (script: tg.File, host: string) => {
	const scriptMetadata = await std.file.executableMetadata(script);
	if (
		scriptMetadata?.format !== "shebang" ||
		!scriptMetadata.interpreter.includes("sh")
	) {
		throw new Error("Expected a shebang sh or bash script");
	}
	const interpreter = tg.File.expect(
		await (await build({ host })).get("bin/bash"),
	);
	return std.wrap(script, { interpreter, identity: "executable" });
};

export const test = tg.command(async () => {
	return await std.assert.pkg(build, spec);
});
