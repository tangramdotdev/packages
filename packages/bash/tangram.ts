import * as gettext from "gettext" with { path: "../gettext" };
import * as ncurses from "ncurses" with { path: "../ncurses" };
import * as pkgconfig from "pkgconfig" with { path: "../pkgconfig" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/bash/",
	license: "GPL-3.0-or-later",
	name: "bash",
	repository: "https://git.savannah.gnu.org/git/bash.git",
	version: "5.2.37",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:9599b22ecd1d5787ad7d3b7bf0c59f312b3396d1e281175dd1f8a4014da621ff";
	return std.download.fromGnu({ name, version, checksum });
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

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: { ncurses: ncursesArg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	// Set up default build dependencies.
	const buildDependencies = [];
	const pkgConfigForBuild = pkgconfig
		.build({ build, host: build })
		.then((d) => {
			return { PKGCONFIG: std.directory.keepSubdirectories(d, "bin") };
		});
	buildDependencies.push(pkgConfigForBuild);
	const gettextForBuild = gettext.build({ build, host: build }).then((d) => {
		return { GETTEXT: std.directory.keepSubdirectories(d, "bin") };
	});
	buildDependencies.push(gettextForBuild);

	// Set up host dependencies.
	const hostDependencies = [];
	const ncursesForHost = await ncurses
		.build({ build, host, sdk }, ncursesArg)
		.then((d) => std.directory.keepSubdirectories(d, "include", "lib"));
	hostDependencies.push(ncursesForHost);

	// Resolve env.
	let env = await std.env.arg(...buildDependencies, ...hostDependencies, env_);

	// Add final build dependencies to env.
	const resolvedBuildDependencies = [];
	const finalPkgConfig = await std.env.getArtifactByKey({
		env,
		key: "PKGCONFIG",
	});
	resolvedBuildDependencies.push(finalPkgConfig);
	const finalGettext = await std.env.getArtifactByKey({ env, key: "GETTEXT" });
	resolvedBuildDependencies.push(finalGettext);
	env = await std.env.arg(env, ...resolvedBuildDependencies);

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

export const test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["bash"],
		metadata,
	});
	return true;
});