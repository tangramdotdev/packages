import * as bzip2 from "bzip2" with { local: "../bzip2" };
import * as libiconv from "libiconv" with { local: "../libiconv" };
import * as openssl from "openssl" with { local: "../openssl" };
import * as std from "std" with { local: "../std" };
import { $ } from "std" with { local: "../std" };
import * as xz from "xz" with { local: "../xz" };
import * as zlib from "zlib" with { local: "../zlib" };

export const metadata = {
	homepage: "https://libarchive.org",
	license:
		"https://raw.githubusercontent.com/libarchive/libarchive/master/COPYING",
	name: "libarchive",
	repository: "https://github.com/libarchive/libarchive",
	version: "3.7.7",
	tag: "libarchive/3.7.7",
	provides: {
		libraries: ["archive"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:879acd83c3399c7caaee73fe5f7418e06087ab2aaf40af3e99b9e29beb29faee";
	const extension = ".tar.xz";
	const base = `https://www.libarchive.org/downloads`;
	return std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		bzip2?: bzip2.Arg;
		libiconv?: libiconv.Arg;
		openssl?: openssl.Arg;
		xz?: xz.Arg;
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
			bzip2: bzip2Arg = {},
			libiconv: libiconvArg = {},
			openssl: opensslArg = {},
			xz: xzArg = {},
			zlib: zlibArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const configure = {
		args: ["--disable-dependency-tracking", "--disable-rpath", "--with-pic"],
	};

	if (build !== host) {
		configure.args.push(`--host=${host}`);
	}

	const phases = { configure };

	const env = std.env.arg(
		bzip2.build({ build, env: env_, host, sdk }, bzip2Arg),
		libiconv.build({ build, env: env_, host, sdk }, libiconvArg),
		openssl.build({ build, env: env_, host, sdk }, opensslArg),
		xz.build({ build, env: env_, host, sdk }, xzArg),
		zlib.build({ build, env: env_, host, sdk }, zlibArg),
		env_,
	);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
			source: source_ ?? source(),
			sdk,
		},
		autotools,
	);
};

export default build;

export const test = async () => {
	const spec: std.assert.PackageSpec = {
		...std.assert.defaultSpec(metadata),
		libraries: std.assert.allLibraries(["archive"], {
			runtimeDeps: [
				openssl.build(),
				zlib.build(),
				bzip2.build(),
				libiconv.build(),
				xz.build(),
			],
		}),
	};
	return await std.assert.pkg(build, spec);
};
