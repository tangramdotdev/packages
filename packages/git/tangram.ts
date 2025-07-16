import * as curl from "curl" with { local: "../curl" };
import * as libiconv from "libiconv" with { local: "../libiconv" };
import * as openssl from "openssl" with { local: "../openssl" };
import * as std from "std" with { local: "../std" };
import * as zlib from "zlib" with { local: "../zlib" };

export const metadata = {
	homepage: "https://git-scm.com/",
	license: "GPL-2.0-only",
	name: "git",
	repository: "https://github.com/git/git",
	version: "2.50.1",
	provides: {
		binaries: ["git"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const base = `https://mirrors.edge.kernel.org/pub/software/scm/${name}`;
	const checksum =
		"sha256:7e3e6c36decbd8f1eedd14d42db6674be03671c2204864befa2a41756c5c8fc4";
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		curl?: curl.Arg;
		libiconv?: libiconv.Arg;
		openssl?: openssl.Arg;
		zlib?: zlib.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: {
			curl: curlArg = {},
			libiconv: libiconvArg = {},
			openssl: opensslArg = {},
			zlib: zlibArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const os = std.triple.os(host);

	const sourceDir = source_ ?? source();

	const configure = {
		args: ["--without-tcltk"],
	};

	const phases = {
		configure,
	};

	let dependencies = [
		curl.build({ build, env: env_, host, sdk }, curlArg),
		openssl.build({ build, env: env_, host, sdk }, opensslArg),
		zlib.build({ build, env: env_, host, sdk }, zlibArg),
	];

	if (std.triple.os(host) === "darwin") {
		dependencies.push(
			libiconv.build({ build, env: env_, host, sdk }, libiconvArg),
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
			setRuntimeLibraryPath: os === "linux",
			source: sourceDir,
		},
		autotools,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
