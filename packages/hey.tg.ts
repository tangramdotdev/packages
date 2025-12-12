import * as go from "go" with { local: "./go.tg.ts" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://github.com/rakyll/hey",
	license: "Apache-2.0",
	name: "hey",
	repository: "https://github.com/rakyll/hey",
	version: "0.1.4",
	tag: "hey/0.1.4",
	provides: {
		binaries: ["hey"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:944097e62dd0bd5012d3b355d9fe2e7b7afcf13cc0b2c06151e0f4c2babfc279";
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
};

export type Arg = go.Arg;

export const build = (...args: std.Args<Arg>) =>
	go.build({ source: source() }, ...args);

export default build;

export const test = async () => {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.allBinaries(metadata.provides.binaries, {
			testArgs: ["--help"],
			snapshot: metadata.name,
		}),
	};
	return await std.assert.pkg(build, spec);
};
