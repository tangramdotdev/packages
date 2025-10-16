import * as pcre2 from "pcre2" with { local: "../pcre2" };
import { cargo } from "rust" with { local: "../rust" };
import * as std from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://github.com/BurntSushi/ripgrep",
	license: "Unlicense",
	name: "ripgrep",
	repository: "https://github.com/BurntSushi/ripgrep",
	version: "15.0.0",
	tag: "ripgrep/15.0.0",
	provides: {
		binaries: ["rg"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:e6b2d35ff79c3327edc0c92a29dc4bb74e82d8ee4b8156fb98e767678716be7a";
	const owner = "BurntSushi";
	const repo = name;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag: version,
	});
};

export type Arg = {
	build?: string;
	cargo?: cargo.Arg;
	dependencies?: {
		pcre2?: std.args.DependencyArg<pcre2.Arg>;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		build: build_,
		cargo: cargoArg = {},
		dependencies: dependencyArgs = {},
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const env = std.env.arg(
		std.env.envArgFromDependency(
			build,
			env_,
			host,
			sdk,
			std.env.runtimeDependency(pcre2.build, dependencyArgs.pcre2),
		),
		env_,
	);

	return cargo.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			features: ["pcre2"],
			sdk,
			source: source_ ?? source(),
		},
		cargoArg,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};

export const cross = async () => {
	// TODO - assert the outputs. Make sure the linux-musl ones produce a static binary.
	return tg.directory({
		"aarch64-unknown-linux-gnu": build({
			host: "aarch64-unknown-linux-gnu",
		}),
		"aarch64-unknown-linux-musl": build({
			host: "aarch64-unknown-linux-musl",
		}),
		"x86_64-unknown-linux-gnu": build({ host: "x86_64-unknown-linux-gnu" }),
		"x86_64-unknown-linux-musl": build({
			host: "x86_64-unknown-linux-musl",
		}),
		"aarch64-apple-darwin": build({ host: "aarch64-apple-darwin" }),
		"x86_64-apple-darwin": build({ host: "x86_64-apple-darwin" }),
	});
};
