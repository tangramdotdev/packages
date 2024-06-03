import * as ncurses from "tg:ncurses" with { path: "../ncurses" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://www.vim.org/",
	name: "vim",
	license:
		"https://github.com/vim/vim/blob/c8b47f26d8ae0db2d65a1cd34d7e34a2c7a6b462/LICENSE",
	repository: "https://github.com/vim/vim",
	version: "9.1.0206",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let owner = name;
	let repo = name;
	let tag = `v${version}`;
	let checksum =
		"sha256:f30b72a30552e0cba68b19e2509177644fe3f4d7427417b03923b78bbca14fa5";
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
	});
});

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies: {
		ncurses: ncurses.Arg;
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

	let dependencies = [ncurses.build(ncursesArg)];
	let env = [...dependencies, env_];

	let output = await std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			env: std.env.arg(env),
			buildInTree: true,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	return output;
});

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["vim"],
		metadata,
	});
	return true;
});
