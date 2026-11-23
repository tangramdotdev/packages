import * as pcre2 from "pcre2" with { source: "./pcre2.tg.ts" };
import { cargo } from "rust" with { source: "./rust" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	builds: { exports: ["default", "build"] },
	homepage: "https://github.com/BurntSushi/ripgrep",
	license: "Unlicense",
	name: "ripgrep",
	repository: "https://github.com/BurntSushi/ripgrep",
	version: "16.0.0",
	tag: "ripgrep/16.0.0",
	provides: {
		binaries: ["rg"],
	},
};

export async function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:17e7a1a0db80ed9618a0963c7ae4aecb8fce25c70cf7ebed514daf2b38a0d153";
	const owner = "BurntSushi";
	const repo = name;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag: version,
	});
}

export function deps() {
	return std.deps({
		pcre2: pcre2.build,
	});
}

export type Arg = cargo.Arg & std.deps.Arg<typeof deps>;

export async function build(...args: tg.Args<Arg>) {
	return cargo.build(
		{ deps, source: source(), features: ["pcre2"], proxy: true },
		...args,
	);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
