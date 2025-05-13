import * as go from "go" with { path: "../go" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://github.com/nats-io/nats-server",
	license: "Apache-2.0",
	name: "nats-server",
	repository: "https://github.com/nats-io/nats-server",
	version: "2.10.23",
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
		"sha256:60b9bbdb84661e9fe1c3834ab1fb421ed74453dd35dc206c04d3272f85b93f28";
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		tag,
		source: "tag",
	});
};

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	go?: go.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		go: goArg = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	return go.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			sdk,
			source: source_ ?? source(),
		},
		goArg,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
