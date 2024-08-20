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
	version: "16.4",
};

export let source = tg.target(async (os: string) => {
	let { name, version } = metadata;
	let checksum =
		"sha256:971766d645aa73e93b9ef4e3be44201b4f45b5477095b049125403f9f3386d6f";
	let extension = ".tar.bz2";
	let base = `https://ftp.postgresql.org/pub/source/v${version}`;
	return await std
		.download({ checksum, base, name, version, extension })
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
		build,
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
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let os = std.triple.os(host);

	let icuArtifact = icu.build({ build, env: env_, host, sdk }, icuArg);
	let lz4Artifact = lz4.build({ build, env: env_, host, sdk }, lz4Arg);
	let ncursesArtifact = ncurses.build(
		{ build, env: env_, host, sdk },
		ncursesArg,
	);
	let readlineArtifact = readline.build(
		{ build, env: env_, host, sdk },
		readlineArg,
	);
	let zlibArtifact = zlib.build({ build, env: env_, host, sdk }, zlibArg);
	let zstdArtifact = zstd.build({ build, env: env_, host, sdk }, zstdArg);
	let env = [
		icuArtifact,
		lz4Artifact,
		ncursesArtifact,
		openssl.build({ build, env: env_, host, sdk }, opensslArg),
		perl.build({ build, host: build }, perlArg),
		pkgconfig.build({ build, host: build }, pkgconfigArg),
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

	return std.autotools.build(
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
