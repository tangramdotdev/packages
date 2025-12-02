import * as go from "go" with { local: "../go" };
import * as std from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://cli.github.com",
	license: "MIT",
	name: "gh",
	repository: "https://github.com/cli/cli",
	version: "2.82.1",
	tag: "gh/2.82.1",
	provides: {
		binaries: ["gh"],
	},
};

export const source = () => {
	const { version } = metadata;
	const checksum =
		"sha256:999bdea5c8baf3d03fe0314127c2c393d6c0f7a504a573ad0c107072973af973";
	return std.download.fromGithub({
		checksum,
		owner: "cli",
		repo: "cli",
		source: "tag",
		tag: `v${version}`,
	});
};

type Arg = {
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

			cgo: false,
			env,
			sdk,
			source: source_ ?? source(),
			generate: false,
			install: {
				command: tg`make install prefix="${tg.output}"`,
			},
			vendor: "go",
		},
		goArg,
	);
};

export default build;

export const test = async () => {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.allBinaries(metadata.provides.binaries, {
			snapshot: metadata.name,
		}),
	};
	return await std.assert.pkg(build, spec);
};
