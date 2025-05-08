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

export let source = tg.command(async () => {
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
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		openssl?: openssl.Arg;
		zlib?: zlib.Arg;
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
		dependencies: { openssl: opensslArg = {}, zlib: zlibArg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let dependencies = [
		openssl.build({ build, host }, opensslArg),
		zlib.build({ build, host }, zlibArg),
	];
	let env = std.env.arg(...dependencies, env_);

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
export let test = tg.command(async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
});
