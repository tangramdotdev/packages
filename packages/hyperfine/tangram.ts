import { cargo } from "rust" with { path: "../rust" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://github.com/sharkdp/hyperfine",
	license: "Apache-2.0, MIT",
	name: "hyperfine",
	repository: "https://github.com/sharkdp/hyperfine",
	version: "1.18.0",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:fea7b92922117ed04b9c84bb9998026264346768804f66baa40743c5528bed6b";
	const owner = "sharkdp";
	const repo = name;
	const tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
	});
});

export type Arg = {
	build?: string;
	cargo?: cargo.Arg;
	env?: std.env.Arg;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
	host?: string;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		build,
		cargo: cargoArgs = {},
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	return cargo.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			sdk,
			source: source_ ?? source(),
		},
		cargoArgs,
	);
});

export default build;

export const test = tg.target(async () => {
	const artifact = build();
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["hyperfine"],
		metadata,
	});
	return artifact;
});
