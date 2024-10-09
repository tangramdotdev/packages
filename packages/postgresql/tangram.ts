import * as icu from "icu" with { path: "../icu" };
import * as lz4 from "lz4" with { path: "../lz4" };
import * as ncurses from "ncurses" with { path: "../ncurses" };
import * as openssl from "openssl" with { path: "../openssl" };
import * as perl from "perl" with { path: "../perl" };
import * as pkgconfig from "pkgconfig" with { path: "../pkgconfig" };
import * as readline from "readline" with { path: "../readline" };
import * as std from "std" with { path: "../std" };
import * as zlib from "zlib" with { path: "../zlib" };
import * as zstd from "zstd" with { path: "../zstd" };

import patches from "./patches" with { type: "directory" };

export const metadata = {
	homepage: "https://www.postgresql.org",
	license: "https://www.postgresql.org/about/licence/",
	name: "postgresql",
	repository: "https://git.postgresql.org/gitweb/?p=postgresql.git;a=summary",
	version: "16.4",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:971766d645aa73e93b9ef4e3be44201b4f45b5477095b049125403f9f3386d6f";
	const extension = ".tar.bz2";
	const base = `https://ftp.postgresql.org/pub/source/v${version}`;
	let output = await std
		.download({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);

	return await std.patch(output, patches);
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
		readline?: readline.Arg;
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
			icu: icuArg = {},
			lz4: lz4Arg = {},
			ncurses: ncursesArg = {},
			openssl: opensslArg = {},
			perl: perlArg = {},
			readline: readlineArg = {},
			zlib: zlibArg = {},
			zstd: zstdArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const os = std.triple.os(host);

	const icuArtifact = icu.build({ build, env: env_, host, sdk }, icuArg);
	const lz4Artifact = lz4.build({ build, env: env_, host, sdk }, lz4Arg);
	const ncursesArtifact = ncurses.build(
		{ build, env: env_, host, sdk },
		ncursesArg,
	);
	const readlineArtifact = readline.build(
		{ build, env: env_, host, sdk },
		readlineArg,
	);
	const zlibArtifact = zlib.build({ build, env: env_, host, sdk }, zlibArg);
	const zstdArtifact = zstd.build({ build, env: env_, host, sdk }, zstdArg);

	const env: tg.Unresolved<Array<std.env.Arg>> = [
		icuArtifact,
		lz4Artifact,
		ncursesArtifact,
		openssl.build({ build, env: env_, host, sdk }, opensslArg),
		perl.build({ build, host: build }, perlArg),
		pkgconfig.build({ build, host: build }),
		readlineArtifact,
		zlibArtifact,
		zstdArtifact,
		env_,
	];

	const sourceDir = source_ ?? source();

	const configure = {
		args: ["--disable-rpath", "--with-lz4", "--with-zstd"],
	};
	const phases = { configure };

	if (os === "darwin") {
		env.push({
			CC: "gcc",
			CXX: "g++",
			ICU_CFLAGS: tg`-I${icuArtifact}/include`,
			ICU_LIBS: tg`-L${icuArtifact}/lib -licuuc -licudata -licui18n -licuio`,
			LZ4_CFLAGS: tg`-I${lz4Artifact}/include`,
			LZ4_LIBS: tg`-L${lz4Artifact}/lib -llz4`,
			ZSTD_CFLAGS: tg`-I${zstdArtifact}/include`,
			ZSTD_LIBS: tg`-L${zstdArtifact}/lib -lzstd`,
		});
	}

	let output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(...env),
			phases,
			sdk,
			setRuntimeLibraryPath: os === "darwin",
			source: sourceDir,
		},
		autotools,
	);

	let libraryPaths = [
		icuArtifact,
		ncursesArtifact,
		readlineArtifact,
		lz4Artifact,
		zlibArtifact,
		zstdArtifact,
	].map((dir) =>
		dir.then((dir: tg.Directory) => dir.get("lib").then(tg.Directory.expect)),
	);
	libraryPaths.push(output.get("lib").then(tg.Directory.expect));

	let binDir = await output.get("bin").then(tg.Directory.expect);
	for await (let [name, artifact] of binDir) {
		let file = tg.File.expect(artifact);
		let wrappedBin = await std.wrap(file, { libraryPaths });
		output = await tg.directory(output, { [`bin/${name}`]: wrappedBin });
	}

	return output;
});

export default build;

export const test = tg.target(async () => {
	const artifact = build();
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["psql"],
		libraries: ["pq"],
		metadata,
	});
	return artifact;
});