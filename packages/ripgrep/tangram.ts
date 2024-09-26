import * as pcre2 from "pcre2" with { path: "../pcre2" };
import * as pkgconfig from "pkg-config" with { path: "../pkgconfig" };
import { cargo } from "rust" with { path: "../rust" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://github.com/BurntSushi/ripgrep",
	license: "Unlicense",
	name: "ripgrep",
	repository: "https://github.com/BurntSushi/ripgrep",
	version: "14.1.0",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:33c6169596a6bbfdc81415910008f26e0809422fda2d849562637996553b2ab6";
	const owner = "BurntSushi";
	const repo = name;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag: version,
	});
});

export type Arg = {
	build?: string;
	cargo?: cargo.Arg;
	dependencies?: {
		pcre2?: pcre2.Arg;
		pkgconfig?: pkgconfig.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		build: build_,
		cargo: cargoArg = {},
		dependencies: { pcre2: pcre2Arg = {}, pkgconfig: pkgconfigArg = {} } = {},
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const env = std.env.arg(
		pkgconfig.build({ build, host: build }, pkgconfigArg),
		pcre2.build({ build, env: env_, host, sdk }, pcre2Arg),
		env_,
	);

	return cargo.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			features: ["pcre2"],
			proxy: true,
			sdk,
			source: source_ ?? source(),
		},
		cargoArg,
	);
});

export default build;

export const test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["rg"],
		metadata,
	});
	return true;
});

export const cross = tg.target(async () => {
	// TODO - assert the outputs. Make sure the linux-musl ones produce a static binary.
	return tg.directory({
		"aarch64-unknown-linux-gnu": build({ host: "aarch64-unknown-linux-gnu" }),
		"aarch64-unknown-linux-musl": build({ host: "aarch64-unknown-linux-musl" }),
		"x86_64-unknown-linux-gnu": build({ host: "x86_64-unknown-linux-gnu" }),
		"x86_64-unknown-linux-musl": build({ host: "x86_64-unknown-linux-musl" }),
		"aarch64-apple-darwin": build({ host: "aarch64-apple-darwin" }),
		"x86_64-apple-darwin": build({ host: "x86_64-apple-darwin" }),
	});
});
