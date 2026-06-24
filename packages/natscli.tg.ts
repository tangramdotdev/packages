import * as go from "go" with { source: "./go.tg.ts" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://github.com/nats-io/natscli",
	license: "Apache-2.0",
	name: "nats-cli",
	repository: "https://github.com/nats-io/natscli",
	version: "0.3.1",
	tag: "natscli/0.3.1",
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
		"sha256:d543d31802276d185b01248bb08892840f84ab055d68e18c240314e224220456";
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
