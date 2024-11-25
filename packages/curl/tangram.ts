import * as libpsl from "libpsl" with { path: "../libpsl" };
import * as openssl from "openssl" with { path: "../openssl" };
import * as perl from "perl" with { path: "../perl" };
import * as pkgConfig from "pkg-config" with { path: "../pkg-config" };
import * as zlib from "zlib" with { path: "../zlib" };
import * as zstd from "zstd" with { path: "../zstd" };
import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://curl.se/",
	license: "MIT",
	name: "curl",
	repository: "https://github.com/curl/curl",
	version: "8.11.0",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:264537d90e58d2b09dddc50944baf3c38e7089151c8986715e2aaeaaf2b8118f";
	const owner = name;
	const repo = name;
	const tag = `curl-${version.replace(/\./g, "_")}`;
	return std.download.fromGithub({
		owner,
		repo,
		tag,
		checksum,
		source: "release",
		version,
	});
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		libpsl?: libpsl.Arg;
		openssl?: openssl.Arg;
		zlib?: zlib.Arg;
		zstd?: zstd.Arg;
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
			libpsl: libpslArg = {},
			openssl: opensslArg = {},
			zlib: zlibArg = {},
			zstd: zstdArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-silent-rules",
			"--enable-optimize",
			"--with-openssl",
			tg`--with-ca-bundle=${std.caCertificates()}/ca-bundle.crt`,
		],
	};
	const phases = { configure };

	const env = [
		perl.default_({ build, host: build }),
		pkgConfig.default_({ build, host: build }),
		libpsl.default_({ build, env: env_, host, sdk }, libpslArg),
		openssl.default_({ build, env: env_, host, sdk }, opensslArg),
		zlib.default_({ build, env: env_, host, sdk }, zlibArg),
		zstd.default_({ build, env: env_, host, sdk }, zstdArg),
		env_,
	];

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(env),
			phases,
			sdk,
			setRuntimeLibraryPath: true,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default default_;

export const test = tg.target(async () => {
	// await std.assert.pkg({
	// 	buildFunction: build,
	// 	binaries: ["curl"],
	// 	metadata,
	// });
	return await $`curl --version | tee $OUTPUT`
		.env(default_())
		.then(tg.File.expect);
});
