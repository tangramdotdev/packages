import * as openssl from "tg:openssl" with { path: "../openssl" };
import * as perl from "tg:perl" with { path: "../perl" };
import * as pkgconfig from "tg:pkg-config" with { path: "../pkgconfig" };
import * as zlib from "tg:zlib" with { path: "../zlib" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://curl.se/",
	license: "MIT",
	name: "curl",
	repository: "https://github.com/curl/curl",
	version: "8.7.1",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:f91249c87f68ea00cf27c44fdfa5a78423e41e71b7d408e5901a9896d905c495";
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
			perl: perlArg = {},
			pkgconfig: pkgconfigArg = {},
			zlib: zlibArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let configure = {
		args: ["--with-openssl"],
	};
	let phases = { configure };

	let openSslDir = await openssl.build(opensslArg);
	let zlibDir = await zlib.build(zlibArg);

	let env = [
		perl.build(perlArg),
		pkgconfig.build(pkgconfigArg),
		openSslDir,
		zlibDir,
		env_,
	];

	let output = await std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
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
	let wrappedCurl = std.wrap(curlExe, {
		env: {
			SSL_CERT_DIR: std.caCertificates(),
		},
		libraryPaths: [libDir, openSslLibDir, zlibLibDir],
	});
	output = await tg.directory(output, {
		["bin/curl"]: wrappedCurl,
	});
	return output;
});

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["curl"],
		metadata,
	});

	return true;
});
