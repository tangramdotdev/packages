import * as pcre2 from "pcre2" with { local: "./pcre2.tg.ts" };
import { cargo } from "rust" with { local: "./rust" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://github.com/BurntSushi/ripgrep",
	license: "Unlicense",
	name: "ripgrep",
	repository: "https://github.com/BurntSushi/ripgrep",
	version: "15.1.0",
	tag: "ripgrep/15.1.0",
	provides: {
		binaries: ["rg"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:046fa01a216793b8bd2750f9d68d4ad43986eb9c0d6122600f993906012972e8";
	const owner = "BurntSushi";
	const repo = name;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag: version,
	});
};

const deps = std.deps({
	pcre2: pcre2.build,
});

export type Arg = cargo.Arg & std.deps.Arg<typeof deps>;

export const build = async (...args: std.Args<Arg>) =>
	cargo.build({ deps, source: source(), features: ["pcre2"] }, ...args);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
