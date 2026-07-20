import * as go from "go" with { source: "./go.tg.ts" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://github.com/rakyll/hey",
	license: "Apache-2.0",
	name: "hey",
	repository: "https://github.com/rakyll/hey",
	version: "0.1.5",
	tag: "hey/0.1.5",
	provides: {
		binaries: ["hey"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:f678bc0f07c62a6513726298873940b70099aa85244efa813f6a0d925092ffe9";
	const owner = "rakyll";
	const repo = name;
	const tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
	});
}

export type Arg = go.Arg;

export function build(...args: std.Args<Arg>) {
	return go.build({ source: source() }, ...args);
}

export default build;

export async function test() {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.allBinaries(metadata.provides.binaries, {
			testArgs: ["--help"],
			snapshot: metadata.name,
		}),
	};
	return await std.assert.pkg(build, spec);
}
