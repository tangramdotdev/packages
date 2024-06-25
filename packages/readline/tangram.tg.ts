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

	let env = std.env.arg(
		ncurses.build(ncursesArg),
		pkgconfig.build(pkgconfigArg),
		env_,
	);

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
