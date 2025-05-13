import * as ncurses from "ncurses" with { path: "../ncurses" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://tiswww.cwru.edu/php/chet/readline/rltop.html",
	license: "https://tiswww.cwru.edu/php/chet/readline/rltop.html",
	name: "readline",
	repository: "http://git.savannah.gnu.org/cgit/readline.git/log/",
	version: "8.2.13",
	provides: {
		libraries: ["readline"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:0e5be4d2937e8bd9b7cd60d46721ce79f88a33415dd68c2d738fb5924638f656";
	return std.download.fromGnu({ name, version, checksum });
};

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

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: dependencyArgs = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const dependencies = [
		std.env.runtimeDependency(ncurses.build, dependencyArgs.ncurses),
	];

	const env = await std.env.arg(
		...dependencies.map((dep) =>
			std.env.envArgFromDependency(build, env_, host, sdk, dep),
		),
		{ CFLAGS: tg.Mutation.suffix("-std=gnu17", " ") },
		env_,
	);

	const configure = {
		args: [
			"--with-curses",
			"--disable-install-examples",
			"--enable-multibyte",
			"--with-shared-termcap-library",
		],
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
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
