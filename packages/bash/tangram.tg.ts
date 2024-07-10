import * as gettext from "tg:gettext" with { path: "../gettext" };
import * as ncurses from "tg:ncurses" with { path: "../ncurses" };
import * as pkgconfig from "tg:pkg-config" with { path: "../pkgconfig" };
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
		ncurses?: ncurses.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		dependencies: { ncurses: ncursesArg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	// Set up default build dependencies.
	let buildDependencies = [];
	let pkgConfigForBuild = pkgconfig.build({ build, host: build }).then((d) => {
		return { PKGCONFIG: std.directory.keepSubdirectories(d, "bin") };
	});
	buildDependencies.push(pkgConfigForBuild);
	let gettextForBuild = gettext.build({ build, host: build }).then((d) => {
		return { GETTEXT: std.directory.keepSubdirectories(d, "bin") };
	});
	buildDependencies.push(gettextForBuild);

	// Set up host dependencies.
	let hostDependencies = [];
	let ncursesForHost = await ncurses
		.build({ build, host, sdk }, ncursesArg)
		.then((d) => std.directory.keepSubdirectories(d, "include", "lib"));
	hostDependencies.push(ncursesForHost);

	// Resolve env.
	let env = await std.env.arg(...buildDependencies, ...hostDependencies, env_);

	// Add final build dependencies to env.
	let resolvedBuildDependencies = [];
	let finalPkgConfig = await std.env.getArtifactByKey({
		env,
		key: "PKGCONFIG",
	});
	resolvedBuildDependencies.push(finalPkgConfig);
	let finalGettext = await std.env.getArtifactByKey({ env, key: "GETTEXT" });
	resolvedBuildDependencies.push(finalGettext);
	env = await std.env.arg(env, ...resolvedBuildDependencies);

	let configure = {
		args: ["--without-bash-malloc", "--with-curses"],
	};
	let phases = { configure };

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
export let wrapScript = async (script: tg.File, host: string) => {
	let scriptMetadata = await std.file.executableMetadata(script);
	if (
		scriptMetadata?.format !== "shebang" ||
		!scriptMetadata.interpreter.includes("sh")
	) {
		throw new Error("Expected a shebang sh or bash script");
	}
	let interpreter = tg.File.expect(
		await (await build({ host })).get("bin/bash"),
	);
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
