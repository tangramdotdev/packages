import * as go from "go" with { local: "./go.tg.ts" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://cli.github.com",
	license: "MIT",
	name: "gh",
	repository: "https://github.com/cli/cli",
	version: "2.82.1",
	tag: "gh/2.82.1",
	provides: {
		binaries: ["gh"],
	},
};

export const source = () => {
	const { version } = metadata;
	const checksum =
		"sha256:999bdea5c8baf3d03fe0314127c2c393d6c0f7a504a573ad0c107072973af973";
	return std.download.fromGithub({
		checksum,
		owner: "cli",
		repo: "cli",
		source: "tag",
		tag: `v${version}`,
	});
};

export type Arg = go.Arg;

export const build = (...args: std.Args<Arg>) =>
	go.build(
		{
			source: source(),
			cgo: false,
			generate: false,
			install: {
				command: tg`make install prefix="${tg.output}"`,
			},
			vendor: "go",
		},
		...args,
	);

export default build;

export const test = async () => {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.allBinaries(metadata.provides.binaries, {
			snapshot: metadata.name,
		}),
	};
	return await std.assert.pkg(build, spec);
};
