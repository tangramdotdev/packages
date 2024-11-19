import * as curl from "curl" with { path: "../curl" };
import * as gettext from "gettext" with { path: "../gettext" };
import * as libiconv from "libiconv" with { path: "../libiconv" };
import * as openssl from "openssl" with { path: "../openssl" };
import * as std from "std" with { path: "../std" };
import * as zlib from "zlib" with { path: "../zlib" };

export const metadata = {
	homepage: "https://git-scm.com/",
	license: "GPL-2.0-only",
	name: "git",
	repository: "https://github.com/git/git",
	version: "2.47.0",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const base = `https://mirrors.edge.kernel.org/pub/software/scm/${name}`;
	const checksum =
		"sha256:1ce114da88704271b43e027c51e04d9399f8c88e9ef7542dae7aebae7d87bc4e";
	return await std
		.download({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		curl?: curl.Arg;
		gettext?: gettext.Arg;
		libiconv?: libiconv.Arg;
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
			curl: curlArg = {},
			gettext: gettextArg = {},
			libiconv: libiconvArg = {},
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

	let dependencies = [
		curl.default_({ build, env: env_, host, sdk }, curlArg),
		gettext.default_({ build, env: env_, host, sdk }, gettextArg),
		openssl.default_({ build, env: env_, host, sdk }, opensslArg),
		zlib.default_({ build, env: env_, host, sdk }, zlibArg),
	];

	if (std.triple.os(host) === "darwin") {
		dependencies.push(
			libiconv.default_({ build, env: env_, host, sdk }, libiconvArg),
		);
	}

	const env = std.env.arg(...dependencies, env_);

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
	await std.assert.pkg({ buildFn: default_, binaries: ["git"], metadata });
	return true;
});
