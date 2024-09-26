import * as libpsl from "libpsl" with { path: "../libpsl" };
import * as openssl from "openssl" with { path: "../openssl" };
import * as perl from "perl" with { path: "../perl" };
import * as pkgconfig from "pkg-config" with { path: "../pkgconfig" };
import * as zlib from "zlib" with { path: "../zlib" };
import * as zstd from "zstd" with { path: "../zstd" };
import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://curl.se/",
	license: "MIT",
	name: "curl",
	repository: "https://github.com/curl/curl",
	version: "8.10.0",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:58c9dcf73493ae9d181fd334b3b3987ff73124621565187ade237bff1064a716";
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

export const build = tg.target(async (...args: std.Args<Arg>) => {
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
		perl.build({ build, host: build }),
		pkgconfig.build({ build, host: build }),
		libpsl.build({build, env: env_, host, sdk }, libpslArg),
		openssl.build({ build, env: env_, host, sdk }, opensslArg),
		zlib.build({ build, env: env_, host, sdk }, zlibArg),
		zstd.build({ build, env: env_, host, sdk }, zstdArg),
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

export default build;

export const test = tg.target(async () => {
	// await std.assert.pkg({
	// 	buildFunction: build,
	// 	binaries: ["curl"],
	// 	metadata,
	// });
	return await $`curl --version | tee $OUTPUT`.env(build()).then(tg.File.expect);

});
