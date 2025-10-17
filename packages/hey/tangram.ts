import * as go from "go" with { local: "../go" };
import * as std from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://github.com/rakyll/hey",
	license: "Apache-2.0",
	name: "hey",
	repository: "https://github.com/rakyll/hey",
	version: "0.1.4",
	tag: "hey/0.1.4",
	provides: {
		binaries: ["hey"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:944097e62dd0bd5012d3b355d9fe2e7b7afcf13cc0b2c06151e0f4c2babfc279";
	const owner = "rakyll";
	const repo = name;
	const tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
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
			network: true,
			sdk,
			source: source_ ?? source(),
		},
		goArg,
	);
};

export default build;

export const test = async () => {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.allBinaries(metadata.provides.binaries, {
			testArgs: ["--help"],
			snapshot: metadata.name,
		}),
	};
	return await std.assert.pkg(build, spec);
};
