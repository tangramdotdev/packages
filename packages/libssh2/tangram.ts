import * as openssl from "openssl" with { path: "../openssl" };
import * as std from "std" with { path: "../std" };
import * as zlib from "zlib" with { path: "../zlib" };

export const metadata = {
	homepage: "https://libssh2.org",
	license: "BSD-3-Clause",
	name: "libssh2",
	repository: "https://github.com/libssh2/libssh2",
	version: "1.11.1",
	provides: {
		libraries: ["ssh2"],
	},
};

export let source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:9954cb54c4f548198a7cbebad248bdc87dd64bd26185708a294b2b50771e3769";
	const owner = name;
	const repo = name;
	const tag = `${name}-${version}`;
	return std.download.fromGithub({
		checksum,
		compression: "xz",
		owner,
		repo,
		source: "release",
		tag,
		version,
	});
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		openssl?: std.args.DependencyArg<openssl.Arg>;
		zlib?: std.args.DependencyArg<zlib.Arg>;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: tg.Args<Arg>) => {
	let {
		autotools = {},
		build,
		dependencies: dependencyArgs = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let dependencies = [
		std.env.runtimeDependency(openssl.build, dependencyArgs.openssl),
		std.env.runtimeDependency(zlib.build, dependencyArgs.zlib),
	];
	let env = std.env.arg(
		...dependencies.map((dep) =>
			std.env.envArgFromDependency(build, env_, host, sdk, dep),
		),
		env_,
	);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
};

export default build;

export let test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
