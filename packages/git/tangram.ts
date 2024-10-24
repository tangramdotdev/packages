import * as gettext from "gettext" with { path: "../gettext" };
import * as openssl from "openssl" with { path: "../openssl" };
import * as std from "std" with { path: "../std" };
import * as zlib from "zlib" with { path: "../zlib" };

export const metadata = {
	homepage: "https://git-scm.com/",
	license: "GPL-2.0-only",
	name: "git",
	repository: "https://github.com/git/git",
	version: "2.45.2",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const base = `https://mirrors.edge.kernel.org/pub/software/scm/${name}`;
	const checksum =
		"sha256:51bfe87eb1c02fed1484051875365eeab229831d30d0cec5d89a14f9e40e9adb";
	return await std
		.download({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		gettext?: gettext.Arg;
		openssl?: openssl.Arg;
		zlib?: zlib.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: {
			gettext: gettextArg = {},
			openssl: opensslArg = {},
			zlib: zlibArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const sourceDir = source_ ?? source();


	const configure = {
		args: ["--without-tcltk"],
	};

	const phases = {
		configure,
	};

	const env = std.env.arg(
		gettext.default_({ build, env: env_, host, sdk }, gettextArg),
		openssl.default_({ build, env: env_, host, sdk }, opensslArg),
		zlib.default_({ build, env: env_, host, sdk }, zlibArg),
		env_,
	);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			buildInTree: true,
			env,
			phases,
			sdk,
			source: sourceDir,
		},
		autotools,
	);
});

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({ packageDir: default_(), binaries: ["git"], metadata });
	return true;
});
