import * as ncurses from "ncurses" with { path: "../ncurses" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.vim.org/",
	name: "vim",
	license:
		"https://github.com/vim/vim/blob/c8b47f26d8ae0db2d65a1cd34d7e34a2c7a6b462/LICENSE",
	repository: "https://github.com/vim/vim",
	version: "9.1.0814",
	provides: {
		binaries: ["vim"],
	},
};

export const source = tg.command(() => {
	const { name, version } = metadata;
	const owner = name;
	const repo = name;
	const tag = `v${version}`;
	const checksum =
		"sha256:5fefd3c8bcc474b56873a4dd7c85748081443baedc253d39634d3553ec65d751";
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
	dependencies?: {
		ncurses?: ncurses.Arg;
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
		dependencies: { ncurses: ncursesArg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const dependencies = [
		ncurses.build({ build, env: env_, host, sdk }, ncursesArg),
	];
	const env = [...dependencies, env_];

	const output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(env),
			buildInTree: true,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	return output;
});

export default build;
export const test = tg.command(async () => {
	const majorMinor = metadata.version.split(".").slice(0, 2).join(".");
	const hasVersion = (name: string) => {
		return {
			name,
			testPredicate: (stdout: string) => stdout.includes(majorMinor),
		};
	};
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: metadata.provides.binaries.map(hasVersion),
	};
	return await std.assert.pkg(build, spec);
});
