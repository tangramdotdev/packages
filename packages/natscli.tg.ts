import * as go from "go" with { local: "./go.tg.ts" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://github.com/nats-io/natscli",
	license: "Apache-2.0",
	name: "nats-cli",
	repository: "https://github.com/nats-io/natscli",
	version: "0.3.0",
	tag: "natscli/0.3.0",
	provides: {
		binaries: ["nats"],
	},
};

export const source = () => {
	const { version } = metadata;
	const owner = "nats-io";
	const repo = "natscli";
	const tag = `v${version}`;
	const checksum =
		"sha256:0df4c49bf1f19023d992ee03d4d4abcf8821eb161db72681a45b2d50cdd2a050";
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
	go.build(
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

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
