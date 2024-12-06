import * as go from "go" with { path: "../go" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://junegunn.github.io/fzf/",
	license: "MIT",
	name: "fzf",
	repository: "https://github.com/junegunn/fzf",
	version: "0.56.3",
};

export const source = tg.target((): Promise<tg.Directory> => {
	const { name, version } = metadata;
	const checksum =
		"sha256:fc7bf3fcfdc3c9562237d1e82196618201a39b3fd6bf3364149516b288f5a24a";
	const tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner: "junegunn",
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

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
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

export const test = tg.target(async () => {
	const majorMinor = metadata.version.split(".").slice(2).join(".");
	await std.assert.pkg({
		buildFn: default_,
		binaries: [
			{ name: "fzf", testPredicate: (stdout) => stdout.includes(majorMinor) },
		],
		metadata,
	});
	return true;
});
