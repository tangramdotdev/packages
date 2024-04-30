import icu from "tg:icu" with { path: "../icu" };
import lz4 from "tg:lz4" with { path: "../lz4" };
import ncurses from "tg:ncurses" with { path: "../ncurses" };
import openssl from "tg:openssl" with { path: "../openssl" };
import perl from "tg:perl" with { path: "../perl" };
import pkgconfig from "tg:pkgconfig" with { path: "../pkgconfig" };
import readline from "tg:readline" with { path: "../readline" };
import * as std from "tg:std" with { path: "../std" };
import zlib from "tg:zlib" with { path: "../zlib" };
import zstd from "tg:zstd" with { path: "../zstd" };

export let metadata = {
	homepage: "https://www.postgresql.org",
	license: "https://www.postgresql.org/about/licence/",
	name: "postgresql",
	repository: "https://git.postgresql.org/gitweb/?p=postgresql.git;a=summary",
	version: "16.2",
};

export let source = tg.target(async (os: string) => {
	let { name, version } = metadata;
	let checksum =
		"sha256:446e88294dbc2c9085ab4b7061a646fa604b4bec03521d5ea671c2e5ad9b2952";
	let extension = ".tar.bz2";
	let packageArchive = std.download.packageArchive({
		name,
		version,
		extension,
	});
	let url = `https://ftp.postgresql.org/pub/source/v${version}/${packageArchive}`;
	let download = tg.Directory.expect(await std.download({ checksum, url }));
	let source = await std.directory.unwrap(download);

	let pwdPatch =
		os === "linux"
			? tg.File.expect(await tg.include("dont_use_bin_pwd_linux.patch"))
			: tg.File.expect(await tg.include("dont_use_bin_pwd_darwin.patch"));
	source = await std.patch(source, pwdPatch);

	return source;
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let postgresql = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;
	let os = std.triple.os(host);

	let env: tg.Unresolved<std.env.Arg> = [
		icu({ ...rest, build, env: env_, host }),
		lz4({ ...rest, build, env: env_, host }),
		ncurses({ ...rest, build, env: env_, host }),
		openssl({ ...rest, build, env: env_, host }),
		perl({ ...rest, build, env: env_, host }),
		pkgconfig({ ...rest, build, env: env_, host }),
		readline({ ...rest, build, env: env_, host }),
		zlib({ ...rest, build, env: env_, host }),
		zstd({ ...rest, build, env: env_, host }),
		env_,
	];

	let sourceDir = source_ ?? source(os);

	let configure = {
		args: ["--disable-rpath", "--with-lz4", "--with-zstd"],
	};
	let phases = { configure };

	if (os === "darwin") {
		configure.args.push("DYLD_FALLBACK_LIBRARY_PATH=$LIBRARY_PATH");
		env.push({ CC: tg.Mutation.unset(), CXX: tg.Mutation.unset() });
	}

	let output = await std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			debug: true,
			env,
			phases,
			source: sourceDir,
		},
		autotools,
	);
	console.log("output", await output.id());

	// Wrap output binaries.
	let libDir = tg.Directory.expect(await output.get("lib"));
	let binDir = tg.Directory.expect(await output.get("bin"));
	for await (let [name, artifact] of binDir) {
		let file = tg.File.expect(artifact);
		let wrappedBin = await std.wrap(file, { libraryPaths: [libDir] });
		output = await tg.directory(output, { [`bin/${name}`]: wrappedBin });
	}

	return output;
});

export default postgresql;

export let test = tg.target(async () => {
	let artifact = postgresql();
	await std.assert.pkg({
		buildFunction: postgresql,
		binaries: ["psql"],
		libraries: ["pq"],
		metadata,
	});
	return artifact;
});
