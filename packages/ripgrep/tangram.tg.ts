import * as pcre2 from "tg:pcre2" with { path: "../pcre2" };
import * as pkgconfig from "tg:pkgconfig" with { path: "../pkgconfig" };
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

export type Arg = {
	// Common args
	build?: string;
	env?: std.env.Arg;
	sdk?: std.sdk.Arg;
	host?: string;
	// Source
	source?: tg.Directory;
	// Builder
	rust?: rust.Arg;
};

export let ripgrep = tg.target(async (arg?: Arg) => {
	let {
		build: build_,
		env: env_,
		host: host_,
		rust: rustArg = {},
		sdk,
		source: source_,
	} = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let env = std.env.arg(
		pkgconfig.build({ build, env: env_, host, sdk }),
		pcre2.build({ build, env: env_, host, sdk }),
		env_,
	);

	return rust.build(
		{
			...std.triple.rotate({ build, host }),
			env,
			features: ["pcre2"],
			sdk,
			source: source_ ?? source(),
			useCargoVendor: true,
		},
		rustArg,
	);
});

export default ripgrep;

export let test = tg.target(async () => {
	// await std.assert.pkg({
	// 	buildFunction: ripgrep,
	// 	binaries: ["rg"],
	// 	metadata,
	// });
	return true;
});
