import * as pkgConfig from "pkgconfig" with { path: "../pkgconfig" };
import * as openssl from "openssl" with { path: "../openssl" };
import * as std from "std" with { path: "../std" };
import * as zlib from "zlib" with { path: "../zlib" };

export let metadata = {
	homepage: "https://libssh2.org",
	license: "BSD-3-Clause",
	name: "libssh2",
	repository: "https://github.com/libssh2/libssh2",
	version: "1.11.0",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:a488a22625296342ddae862de1d59633e6d446eff8417398e06674a49be3d7c2";
	let owner = name;
	let repo = name;
	let tag = `${name}-${version}`;
	return std.download.fromGithub({
		checksum,
		compressionFormat: "xz",
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

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
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
		pkgConfig.default_({ build, host: build }),
		openssl.default_({ build, host }, opensslArg),
		zlib.default_({ build, host }, zlibArg),
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
});

export default default_;

export let test = tg.target(async () => {
	await std.assert.pkg({ packageDir: default_(), libraries: ["ssh2"] });
	return true;
});
