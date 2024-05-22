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
	// Dependencies
	dependencies?: {
		pcre2?: pcre2.Arg;
		pkgconfig?: pkgconfig.Arg;
	};
};

export let ripgrep = tg.target(async (...args: std.Args<Arg>) => {
	let {
		build,
		dependencies: { pcre2: pcre2Arg = {}, pkgconfig: pkgconfigArg = {} } = {},
		env: env_,
		host,
		rust: rustArg = {},
		source: source_,
		...rest
	} = await std.args.apply<Arg>(args);

	let env = [pkgconfig.build(pkgconfigArg), pcre2.build(pcre2Arg), env_];

	return rust.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			features: ["pcre2"],
			source: source_ ?? source(),
		},
		rustArg,
	);
});

export default ripgrep;

export let arg = tg.target(async (...args: std.Args<Arg>) => {
	return await std.args.apply<Arg>(args);
});

export let test = tg.target(async () => {
	// await std.assert.pkg({
	// 	buildFunction: ripgrep,
	// 	binaries: ["rg"],
	// 	metadata,
	// });
	return true;
});
