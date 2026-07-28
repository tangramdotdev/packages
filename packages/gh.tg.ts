import * as go from "go" with { source: "./go.tg.ts" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://cli.github.com",
	license: "MIT",
	name: "gh",
	repository: "https://github.com/cli/cli",
	version: "2.96.0",
	tag: "gh/2.96.0",
	provides: {
		binaries: ["gh"],
	},
};

export function source() {
	const { version } = metadata;
	const checksum =
		"sha256:8d80d0aeccea7bec8024f8c30365bbfa76852901f2b2cb0afb7ab2cbf6d317c2";
	return std.download.fromGithub({
		checksum,
		owner: "cli",
		repo: "cli",
		source: "tag",
		tag: `v${version}`,
	});
}

export type Arg = go.Arg;

export function build(...args: tg.Args<Arg>) {
	return go.build(
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
}

export default build;

export async function test() {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.allBinaries(metadata.provides.binaries, {
			snapshot: metadata.name,
		}),
	};
	return await std.assert.pkg(build, spec);
}
