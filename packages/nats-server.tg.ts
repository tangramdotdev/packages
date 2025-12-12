import * as go from "go" with { local: "./go.tg.ts" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://github.com/nats-io/nats-server",
	license: "Apache-2.0",
	name: "nats-server",
	repository: "https://github.com/nats-io/nats-server",
	version: "2.12.1",
	tag: "nats-server/2.12.1",
	provides: {
		binaries: ["nats-server"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const owner = "nats-io";
	const repo = name;
	const tag = `v${version}`;
	const checksum =
		"sha256:4d06c190294638aed37728f663f59de30b1b7492bb0af1891bccc3647025fc0f";
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		tag,
		source: "tag",
	});
};

export type Arg = go.Arg;

export const build = (...args: std.Args<Arg>) =>
	go.build({ source: source(), cgo: false }, ...args);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
