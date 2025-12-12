import * as ncurses from "ncurses" with { local: "./ncurses.tg.ts" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.vim.org/",
	name: "vim",
	license:
		"https://github.com/vim/vim/blob/c8b47f26d8ae0db2d65a1cd34d7e34a2c7a6b462/LICENSE",
	repository: "https://github.com/vim/vim",
	version: "9.1.0814",
	tag: "vim/9.1.0814",
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
		"sha256:5fefd3c8bcc474b56873a4dd7c85748081443baedc253d39634d3553ec65d751";
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
	});
};

const deps = await std.deps({
	ncurses: ncurses.build,
});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		std.autotools.arg({ source: source(), deps, buildInTree: true }, ...args),
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
