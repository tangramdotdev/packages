import * as ncurses from "ncurses" with { local: "../ncurses" };
import * as std from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://tiswww.cwru.edu/php/chet/readline/rltop.html",
	license: "https://tiswww.cwru.edu/php/chet/readline/rltop.html",
	name: "readline",
	repository: "http://git.savannah.gnu.org/cgit/readline.git/log/",
	version: "8.3",
	tag: "readline/8.3",
	provides: {
		libraries: ["readline"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:fe5383204467828cd495ee8d1d3c037a7eba1389c22bc6a041f627976f9061cc";
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

	const envs = [
		...dependencies.map((dep) =>
			std.env.envArgFromDependency(build, env_, host, sdk, dep),
		),
		{
			CFLAGS: tg.Mutation.suffix("-std=gnu17", " "),
		},
		env_,
	];

	const env = std.env.arg(...envs);

	const configure = {
		args: ["--with-curses", "--disable-install-examples", "--enable-multibyte"],
	};
	if (build === host) {
		// FIXME - how do i use this flag with cross compilation.
		configure.args.push("--with-shared-termcap-library");
	}
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
