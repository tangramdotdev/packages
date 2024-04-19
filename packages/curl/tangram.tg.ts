import openssl from "tg:openssl" with { path: "../openssl" };
import perl from "tg:perl" with { path: "../perl" };
import pkgconfig from "tg:pkgconfig" with { path: "../pkgconfig" };
import zlib from "tg:zlib" with { path: "../zlib" };
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

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let curl = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let configure = {
		args: ["--with-openssl"],
	};
	let phases = { configure };

	let openSslDir = await openssl({ ...rest, build, env: env_, host });
	let zlibDir = await zlib({ ...rest, build, env: env_, host });

	let env = [
		perl({ ...rest, build, env: env_, host }),
		pkgconfig({ ...rest, build, env: env_, host }),
		openSslDir,
		zlibDir,
		env_,
	];

	let output = await std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases,
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

export default curl;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: curl,
		binaries: ["curl"],
		metadata,
	});

	return true;
});
