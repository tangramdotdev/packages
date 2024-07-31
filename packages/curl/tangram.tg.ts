import * as openssl from "tg:openssl" with { path: "../openssl" };
import * as perl from "tg:perl" with { path: "../perl" };
import * as pkgconfig from "tg:pkg-config" with { path: "../pkgconfig" };
import * as zlib from "tg:zlib" with { path: "../zlib" };
import * as zstd from "tg:zstd" with { path: "../zstd" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://curl.se/",
	license: "MIT",
	name: "curl",
	repository: "https://github.com/curl/curl",
	version: "8.9.1",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:291124a007ee5111997825940b3876b3048f7d31e73e9caa681b80fe48b2dcd5";
	let owner = name;
	let repo = name;
	let tag = `curl-${version.replace(/\./g, "_")}`;
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
		openssl?: openssl.Arg;
		zlib?: zlib.Arg;
		zstd?: zstd.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		dependencies: {
			openssl: opensslArg = {},
			zlib: zlibArg = {},
			zstd: zstdArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let os = std.triple.os(host);

	let runtimeLibEnvVar =
		os === "darwin" ? "DYLD_FALLBACK_LIBRARY_PATH" : "LT_SYS_LIBRARY_PATH";
	let prepare = `export ${runtimeLibEnvVar}="$LIBRARY_PATH"`;

	let configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-silent-rules",
			"--enable-optimize",
			"--with-openssl",
			tg`--with-ca-bundle=${std.caCertificates()}/ca-bundle.crt`,
		],
	};
	let phases = { prepare, configure };

	let openSslDir = await openssl.build(
		{ build, env: env_, host, sdk },
		opensslArg,
	);
	let zlibDir = await zlib.build({ build, env: env_, host, sdk }, zlibArg);
	let zstdDir = await zstd.build({ build, env: env_, host, sdk }, zstdArg);

	let env = [
		perl.build({ build, host: build }),
		pkgconfig.build({ build, host: build }),
		openSslDir,
		zlibDir,
		zstdDir,
		env_,
	];

	let output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(env),
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	// Wrap binary to always include the certificates and libdir.
	let curlExe = tg.File.expect(await output.get("bin/curl"));
	let libDir = tg.Directory.expect(await output.get("lib"));
	let openSslLibDir = tg.Directory.expect(await openSslDir.get("lib"));
	let zlibLibDir = tg.Directory.expect(await zlibDir.get("lib"));
	let zsdtLibDir = tg.Directory.expect(await zstdDir.get("lib"));
	let wrappedCurl = std.wrap(curlExe, {
		libraryPaths: [libDir, openSslLibDir, zlibLibDir, zsdtLibDir],
	});
	output = await tg.directory(output, {
		["bin/curl"]: wrappedCurl,
	});
	return output;
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["curl"],
		metadata,
	});

	return true;
});
