import * as icu from "tg:icu" with { path: "../icu" };
import * as lz4 from "tg:lz4" with { path: "../lz4" };
import * as ncurses from "tg:ncurses" with { path: "../ncurses" };
import * as openssl from "tg:openssl" with { path: "../openssl" };
import * as perl from "tg:perl" with { path: "../perl" };
import * as pkgconfig from "tg:pkg-config" with { path: "../pkgconfig" };
import * as readline from "tg:readline" with { path: "../readline" };
import * as std from "tg:std" with { path: "../std" };
import * as zlib from "tg:zlib" with { path: "../zlib" };
import * as zstd from "tg:zstd" with { path: "../zstd" };

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
	return await std
		.download({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		icu?: icu.Arg;
		lz4?: lz4.Arg;
		ncurses?: ncurses.Arg;
		openssl?: openssl.Arg;
		perl?: perl.Arg;
		pkgconfig?: pkgconfig.Arg;
		readline?: readline.Arg;
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
			icu: icuArg = {},
			lz4: lz4Arg = {},
			ncurses: ncursesArg = {},
			openssl: opensslArg = {},
			perl: perlArg = {},
			pkgconfig: pkgconfigArg = {},
			readline: readlineArg = {},
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

	let icuArtifact = icu.build(icuArg);
	let lz4Artifact = lz4.build(lz4Arg);
	let ncursesArtifact = ncurses.build(ncursesArg);
	let readlineArtifact = readline.build(readlineArg);
	let zlibArtifact = zlib.build(zlibArg);
	let zstdArtifact = zstd.build(zstdArg);
	let env = [
		icuArtifact,
		lz4Artifact,
		ncursesArtifact,
		openssl.build(opensslArg),
		perl.build(perlArg),
		pkgconfig.build(pkgconfigArg),
		readlineArtifact,
		zlibArtifact,
		zstdArtifact,
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
			CC: "gcc",
			CXX: "g++",
		});
	}

	let output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			buildInTree: true,
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
		let icuLibDir = tg.Directory.expect(await (await icuArtifact).get("lib"));
		let lz4LibDir = tg.Directory.expect(await (await lz4Artifact).get("lib"));
		let zlibLibDir = tg.Directory.expect(await (await zlibArtifact).get("lib"));
		let zstdLibDir = tg.Directory.expect(await (await zstdArtifact).get("lib"));
		libraryPaths.push(icuLibDir);
		libraryPaths.push(lz4LibDir);
		libraryPaths.push(ncursesLibDir);
		libraryPaths.push(readlineLibDir);
		libraryPaths.push(zlibLibDir);
		libraryPaths.push(zstdLibDir);
	}
	let binDir = tg.Directory.expect(await output.get("bin"));
	for await (let [name, artifact] of binDir) {
		let file = tg.File.expect(artifact);
		let wrappedBin = await std.wrap(file, { libraryPaths });
		output = await tg.directory(output, { [`bin/${name}`]: wrappedBin });
	}

	return output;
});

export default build;

export let test = tg.target(async () => {
	let artifact = build();
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["psql"],
		libraries: ["pq"],
		metadata,
	});
	return artifact;
});
