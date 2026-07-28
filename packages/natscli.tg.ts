import * as go from "go" with { source: "./go.tg.ts" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://github.com/nats-io/natscli",
	license: "Apache-2.0",
	name: "nats-cli",
	repository: "https://github.com/nats-io/natscli",
	version: "0.4.0",
	tag: "natscli/0.4.0",
	provides: {
		binaries: ["nats"],
	},
};

export function source() {
	const { version } = metadata;
	const owner = "nats-io";
	const repo = "natscli";
	const tag = `v${version}`;
	const checksum =
		"sha256:6dc9056aa439f90de2a705983005363ae05f1f9985b81881cbfffa867a344ef6";
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		tag,
		source: "tag",
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
				command: tg`go install -v -ldflags "-X main.version=${metadata.version}" ./nats`,
			},
		},
		...args,
	);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
