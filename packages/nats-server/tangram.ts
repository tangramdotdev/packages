import * as go from "go" with { path: "../go" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://github.com/nats-io/nats-server",
	license: "Apache-2.0",
	name: "nats-server",
	repository: "https://github.com/nats-io/nats-server",
	version: "2.10.22",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const owner = "nats-io";
	const repo = name;
	const tag = `v${version}`;
	const checksum =
		"sha256:27bbfa502d19a698f33ecf7c91b6d85ab13b11e41cb7ced6371aa3057821bc07";
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		tag,
		source: "tag",
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

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
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

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({
		buildFn: default_,
		binaries: ["nats-server"],
		metadata,
	});
	return true;
});
