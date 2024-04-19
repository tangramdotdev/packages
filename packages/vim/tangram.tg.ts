import ncurses from "tg:ncurses" with { path: "../ncurses" };
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
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let vim = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let dependencies = [ncurses(arg)];
	let env = [...dependencies, env_];

	let output = await std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			buildInTree: true,
			source: source_ ?? source(),
		},
		autotools,
	);

	return output;
});

export default vim;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: vim,
		binaries: ["vim"],
		metadata,
	});
	return true;
});
