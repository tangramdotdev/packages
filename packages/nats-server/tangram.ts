import * as go from "go" with { path: "../go" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://github.com/nats-io/nats-server",
	license: "Apache-2.0",
	name: "nats-server",
	repository: "https://github.com/nats-io/nats-server",
	version: "2.10.16",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const owner = "nats-io";
	const repo = name;
	const tag = `v${version}`;
	const checksum =
		"sha256:235b8fdd9a005e4bfb7a14752e4c171d168707662fb5ed00ed064641c8fa588b";
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		tag,
	});
});

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	go?: go.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		go: goArg = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	return go.build(
		{
			...(await std.triple.rotate({ build, host })),
			checksum: "unsafe",
			env,
			sdk,
			source: source_ ?? source(),
		},
		goArg,
	);
});

export default build;
