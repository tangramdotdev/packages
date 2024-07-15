import * as ncurses from "tg:ncurses" with { path: "../ncurses" };
import * as pkgconfig from "tg:pkg-config" with { path: "../pkgconfig" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://tiswww.cwru.edu/php/chet/readline/rltop.html",
	license: "https://tiswww.cwru.edu/php/chet/readline/rltop.html",
	name: "readline",
	repository: "http://git.savannah.gnu.org/cgit/readline.git/log/",
	version: "8.2",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:3feb7171f16a84ee82ca18a36d7b9be109a52c04f492a053331d7d1095007c35";
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

	// Set up host dependencies.
	let hostDependencies = [];
	let ncursesForHost = await ncurses.build({ build, host, sdk }, ncursesArg);
	hostDependencies.push(ncursesForHost);

	// Resolve env.
	let env = await std.env.arg(...buildDependencies, ...hostDependencies, env_);

	// Add final build dependencies to env.
	let resolvedBuildDependencies = [];
	let finalPkConfig = await std.env.getArtifactByKey({ env, key: "PKGCONFIG" });
	resolvedBuildDependencies.push(finalPkConfig);
	env = await std.env.arg(env, ...resolvedBuildDependencies);

	let configure = {
		args: [
			"--with-curses",
			"--disable-install-examples",
			"--with-shared-termcap-library",
		],
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

export let test = tg.target(async () => {
	let artifact = build();
	await std.assert.pkg({
		buildFunction: build,
		metadata,
	});
	return artifact;
});
