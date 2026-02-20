import * as ncurses from "ncurses" with { local: "./ncurses.tg.ts" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.vim.org/",
	name: "vim",
	license:
		"https://github.com/vim/vim/blob/c8b47f26d8ae0db2d65a1cd34d7e34a2c7a6b462/LICENSE",
	repository: "https://github.com/vim/vim",
	version: "9.2.0",
	tag: "vim/9.2.0",
	provides: {
		binaries: ["vim"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const owner = name;
	const repo = name;
	const tag = `v${version}`;
	const checksum =
		"sha256:9c60fc4488d78bbca9069e74e9cfafd006bdfcece5bb0971eac6268531f1b51f";
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
	});
};

export const deps = () =>
	std.deps({
		ncurses: ncurses.build,
	});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		{
			source: source(),
			deps,
			buildInTree: true,
			fortifySource: false,
			phases: {
				configure: { args: ["--with-tlib=ncursesw"] },
			},
		},
		...args,
	);

export default build;

export const test = async () => {
	const majorMinor = metadata.version.split(".").slice(0, 2).join(".");
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.allBinaries(metadata.provides.binaries, {
			snapshot: majorMinor,
		}),
	};
	return await std.assert.pkg(build, spec);
};
