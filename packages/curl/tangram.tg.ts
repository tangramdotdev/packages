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
	version: "8.8.0",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:77c0e1cd35ab5b45b659645a93b46d660224d0024f1185e8a95cdb27ae3d787d";
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
		perl?: perl.Arg;
		pkgconfig?: pkgconfig.Arg;
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
		build: build_,
		dependencies: {
			openssl: opensslArg = {},
			perl: perlArg = {},
			pkgconfig: pkgconfigArg = {},
			zlib: zlibArg = {},
			zstd: zstdArg = {},
		} = {},
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;
	let os = std.triple.os(host);

	let runtimeLibEnvVar =
		os === "darwin" ? "DYLD_FALLBACK_LIBRARY_PATH" : "LD_LIBRARY_PATH";
	let prepare = `export ${runtimeLibEnvVar}="$LIBRARY_PATH"`;

	let configure = {
		args: ["--with-openssl"],
	};
	let phases = { prepare, configure };

	let openSslDir = await openssl.build(opensslArg);
	let zlibDir = await zlib.build(zlibArg);
	let zstdDir = await zstd.build(zstdArg);

	let env = [
		perl.build(perlArg),
		pkgconfig.build(pkgconfigArg),
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
		env: {
			SSL_CERT_DIR: std.caCertificates(),
		},
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
