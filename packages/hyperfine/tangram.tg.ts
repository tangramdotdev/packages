import * as rust from "tg:rust" with { path: "../rust" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://github.com/sharkdp/hyperfine",
	license: "Apache-2.0, MIT",
	name: "hyperfine",
	repository: "https://github.com/sharkdp/hyperfine",
	version: "1.18.0",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:fea7b92922117ed04b9c84bb9998026264346768804f66baa40743c5528bed6b";
	let owner = "sharkdp";
	let repo = name;
	let tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
	});
});

type Arg = {
	build?: string;
	env?: std.env.Arg;
	rust?: tg.MaybeNestedArray<rust.Arg>;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
	host?: string;
};

export let hyperfine = tg.target(async (arg?: Arg) => {
	let {
		build,
		host,
		rust: rustArgs = [],
		source: source_,
		...rest
	} = arg ?? {};

	return rust.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			source: source_ ?? source(),
		},
		rustArgs,
	);
});

export default hyperfine;

export let test = tg.target(async () => {
	let artifact = hyperfine();
	await std.assert.pkg({
		buildFunction: hyperfine,
		binaries: ["hyperfine"],
		metadata,
	});
	return artifact;
});
