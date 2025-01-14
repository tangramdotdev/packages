import * as std from "std" with { path: "../std" };

export const metadata = {
	name: "podman",
	homepage: "https://podman.io/",
	license: "Apache-2.0",
	repository: "https://github.com/containers/podman",
	version: "5.3.1",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:5b4e9ddce69cc2c8c8b8529e90093ae3ea9cb2959e2fceb98469b282dbffbcc7";
	const tag = `v${version}`;
	const owner = "containers";
	return std.download.fromGithub({
		checksum,
		owner,
		repo: name,
		source: "tag",
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

export const default_ = tg.target(() => {
	const {
		go: goArg = {},
		build,
		env,
		host,
		sdk,
		source: source_,
		...rest
	} = await std.args.apply<Arg>(...args);

	return go.build(
		{
			...rest,
			...(await std.triple.rotate({ build, host })),
			source: source_ ?? source(),
		},
		goArg,
	);
});

export default default_;

export const test = tg.target(() => {
	await std.assert.pkg({
		buildFn: default_,
		binaries: ["podman"],
		metadata,
	});
	return true;
});
