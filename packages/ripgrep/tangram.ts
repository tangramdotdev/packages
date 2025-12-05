import * as pcre2 from "pcre2" with { local: "../pcre2" };
import { cargo } from "rust" with { local: "../rust" };
import * as std from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://github.com/BurntSushi/ripgrep",
	license: "Unlicense",
	name: "ripgrep",
	repository: "https://github.com/BurntSushi/ripgrep",
	version: "15.1.0",
	tag: "ripgrep/15.1.0",
	provides: {
		binaries: ["rg"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:046fa01a216793b8bd2750f9d68d4ad43986eb9c0d6122600f993906012972e8";
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
		build,
		cargo: cargoArg = {},
		dependencies: dependencyArgs = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

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
