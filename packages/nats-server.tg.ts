import * as go from "go" with { source: "./go.tg.ts" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://github.com/nats-io/nats-server",
	license: "Apache-2.0",
	name: "nats-server",
	repository: "https://github.com/nats-io/nats-server",
	version: "2.14.3",
	tag: "nats-server/2.14.3",
	provides: {
		binaries: ["nats-server"],
	},
};

export function source() {
	const { name, version } = metadata;
	const owner = "nats-io";
	const repo = name;
	const tag = `v${version}`;
	const checksum =
		"sha256:dba5286035ce9017b897ea24a783551dc28b07ad50c78da5471ead2bcfab3e86";
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		tag,
		source: "tag",
	});
}

export type Arg = go.Arg;

export function build(...args: std.Args<Arg>) {
	return go.build({ source: source(), cgo: false }, ...args);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
