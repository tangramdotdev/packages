import * as go from "go" with { local: "../go" };
import * as std from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://junegunn.github.io/fzf/",
	license: "MIT",
	name: "fzf",
	repository: "https://github.com/junegunn/fzf",
	version: "0.57.0",
	tag: "fzf/0.57.0",
	provides: {
		binaries: ["fzf"],
	},
};

export const source = (): Promise<tg.Directory> => {
	const { name, version } = metadata;
	const checksum =
		"sha256:d4e8e25fad2d3f75943b403c40b61326db74b705bf629c279978fdd0ceb1f97c";
	const tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner: "junegunn",
		repo: name,
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
		...rest
	} = await std.packages.applyArgs<Arg>(...args);

	return go.build(
		{
			...rest,
			...(await std.triple.rotate({ build, host })),
			source: source_ ?? source(),
		},
		goArg,
	);
};

export default build;

export const test = async () => {
	const majorMinor = metadata.version.split(".").slice(2).join(".");
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.allBinaries(metadata.provides.binaries, {
			snapshot: majorMinor,
		}),
	};
	return await std.assert.pkg(build, spec);
};
