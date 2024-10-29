import * as go from "go" with { path: "../go" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://junegunn.github.io/fzf/",
	license: "MIT",
	name: "fzf",
	repository: "https://github.com/junegunn/fzf",
	version: "0.55.0",
};

export const source = tg.target((): Promise<tg.Directory> => {
	const { name, version } = metadata;
	const checksum =
		"sha256:805383f71bca7f8fb271ecd716852aea88fd898d5027d58add9e43df6ea766da";
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
		packageDir: default_(),
		binaries: [
			{ name: "fzf", testPredicate: (stdout) => stdout.includes(majorMinor) },
		],
		metadata,
	});
	return true;
});
