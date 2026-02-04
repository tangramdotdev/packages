import * as go from "go" with { local: "./go.tg.ts" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://github.com/nats-io/nats-server",
	license: "Apache-2.0",
	name: "nats-server",
	repository: "https://github.com/nats-io/nats-server",
	version: "2.12.3",
	tag: "nats-server/2.12.3",
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
		"sha256:34611454a6c38aed0bb26711b2d89620cb4c298cca93485539c7dc1e84558054";
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
