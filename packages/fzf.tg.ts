import * as go from "go" with { local: "./go.tg.ts" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://junegunn.github.io/fzf/",
	license: "MIT",
	name: "fzf",
	repository: "https://github.com/junegunn/fzf",
	version: "0.66.1",
	tag: "fzf/0.66.1",
	provides: {
		binaries: ["fzf"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:ae70923dba524d794451b806dbbb605684596c1b23e37cc5100daa04b984b706";
	const tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner: "junegunn",
		repo: name,
		source: "tag",
		tag,
	});
};

export type Arg = go.Arg;

export const build = (...args: std.Args<Arg>) =>
	go.build({ source: source() }, ...args);

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
