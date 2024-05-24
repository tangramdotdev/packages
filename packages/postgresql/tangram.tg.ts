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

import pwdPatchLinux from "./dont_use_bin_pwd_linux.patch" with {
	type: "file",
};
import pwdPatchDarwin from "./dont_use_bin_pwd_darwin.patch" with {
	type: "file",
};

export let metadata = {
	homepage: "https://www.postgresql.org",
	license: "https://www.postgresql.org/about/licence/",
	name: "postgresql",
	repository: "https://git.postgresql.org/gitweb/?p=postgresql.git;a=summary",
	version: "16.3",
};

export let source = tg.target(async (os: string) => {
	let { name, version } = metadata;
	let checksum =
		"sha256:331963d5d3dc4caf4216a049fa40b66d6bcb8c730615859411b9518764e60585";
	let extension = ".tar.bz2";
	let packageArchive = std.download.packageArchive({
		name,
		version,
		extension,
	});
	let url = `https://ftp.postgresql.org/pub/source/v${version}/${packageArchive}`;
	let download = tg.Directory.expect(await std.download({ checksum, url }));
	let source = await std.directory.unwrap(download);

	let pwdPatch = os === "linux" ? pwdPatchLinux : pwdPatchDarwin;
	source = await std.patch(source, pwdPatch);

	return source;
});

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let postgresql = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;
	let os = std.triple.os(host);

	let ncursesArtifact = ncurses({ build, host, sdk });
	let readlineArtifact = readline({ build, host, sdk });
	let env: tg.Unresolved<Array<std.env.Arg>> = [
		icu({ build, env: env_, host, sdk }),
		lz4({ build, env: env_, host, sdk }),
		ncursesArtifact,
		openssl({ build, env: env_, host, sdk }),
		perl({ build, env: env_, host, sdk }),
		pkgconfig({ build, env: env_, host, sdk }),
		readlineArtifact,
		zlib({ build, env: env_, host, sdk }),
		zstd({ build, env: env_, host, sdk }),
		env_,
	];

	let sourceDir = source_ ?? source(os);

	let configure = {
		args: ["--disable-rpath", "--with-lz4", "--with-zstd"],
	};
	let phases = { configure };

	if (os === "darwin") {
		configure.args.push("DYLD_FALLBACK_LIBRARY_PATH=$LIBRARY_PATH");
		env.push({
			CC: tg.Mutation.unset(),
			CXX: tg.Mutation.unset(),
			TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: "none",
		});
	}

	let output = await std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			env: std.env.arg(...env),
			phases,
			sdk,
			source: sourceDir,
		},
		autotools,
	);

	// Wrap output binaries.
	let libDir = tg.Directory.expect(await output.get("lib"));
	let libraryPaths = [libDir];
	if (os === "darwin") {
		let ncursesLibDir = tg.Directory.expect(
			await (await ncursesArtifact).get("lib"),
		);
		let readlineLibDir = tg.Directory.expect(
			await (await readlineArtifact).get("lib"),
		);
		//libraryPaths.push(ncursesLibDir);
		//libraryPaths.push(readlineLibDir);
	}
	let binDir = tg.Directory.expect(await output.get("bin"));
	for await (let [name, artifact] of binDir) {
		let file = tg.File.expect(artifact);
		let wrappedBin = await std.wrap(file, { libraryPaths });
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
