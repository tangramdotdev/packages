import ncurses from "tg:ncurses" with { path: "../ncurses" };
import pkgconfig from "tg:pkgconfig" with { path: "../pkgconfig" };
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

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let readline = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let env = std.env.arg(
		ncurses({ build, env: env_, host, sdk }),
		pkgconfig({ build, env: env_, host, sdk }),
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
			...std.triple.rotate({ build, host }),
			env,
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default readline;

export let test = tg.target(async () => {
	let artifact = readline();
	await std.assert.pkg({
		buildFunction: readline,
		metadata,
	});
	return artifact;
});
