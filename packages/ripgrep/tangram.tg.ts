import pcre2 from "tg:pcre2" with { path: "../pcre2" };
import pkgconfig from "tg:pkgconfig" with { path: "../pkgconfig" };
import * as rust from "tg:rust" with { path: "../rust" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://github.com/BurntSushi/ripgrep",
	license: "Unlicense",
	name: "ripgrep",
	repository: "https://github.com/BurntSushi/ripgrep",
	version: "14.1.0",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:33c6169596a6bbfdc81415910008f26e0809422fda2d849562637996553b2ab6";
	let owner = "BurntSushi";
	let repo = name;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag: version,
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

export let ripgrep = tg.target(async (arg?: Arg) => {
	let {
		build,
		env: env_,
		host,
		rust: rustArgs = [],
		source: source_,
		...rest
	} = arg ?? {};

	let env = [
		pkgconfig({ ...rest, build, env: env_, host }),
		pcre2({ ...rest, build, env: env_, host }),
		env_,
	];

	return rust.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			features: ["pcre2"],
			source: source_ ?? source(),
		},
		rustArgs,
	);
});

export default ripgrep;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: ripgrep,
		binaries: ["rg"],
		metadata,
	});
	return true;
});
