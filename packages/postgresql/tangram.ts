import * as flex from "flex" with { local: "../flex" };
import * as icu from "icu" with { local: "../icu" };
import * as lz4 from "lz4" with { local: "../lz4" };
import * as ncurses from "ncurses" with { local: "../ncurses" };
import * as openssl from "openssl" with { local: "../openssl" };
import * as readline from "readline" with { local: "../readline" };
import * as std from "std" with { local: "../std" };
import * as tzdb from "tzdb" with { local: "../tzdb" };
import * as zlib from "zlib" with { local: "../zlib" };
import * as zstd from "zstd" with { local: "../zstd" };

import patches from "./patches" with { type: "directory" };

export const metadata = {
	homepage: "https://www.postgresql.org",
	license: "https://www.postgresql.org/about/licence/",
	name: "postgresql",
	repository: "https://git.postgresql.org/gitweb/?p=postgresql.git;a=summary",
	version: "17.6",
	tag: "postgresql/17.6",
	provides: {
		binaries: [
			"clusterdb",
			"createdb",
			"createuser",
			"dropdb",
			"dropuser",
			"ecpg",
			"initdb",
			"pg_amcheck",
			"pg_archivecleanup",
			"pg_basebackup",
			"pg_checksums",
			"pg_combinebackup",
			"pg_config",
			"pg_controldata",
			"pg_createsubscriber",
			"pg_ctl",
			"pg_dump",
			"pg_dumpall",
			"pg_isready",
			"pg_receivewal",
			"pg_recvlogical",
			"pg_resetwal",
			"pg_restore",
			"pg_rewind",
			"pg_test_fsync",
			"pg_test_timing",
			"pg_upgrade",
			"pg_verifybackup",
			"pg_waldump",
			"pg_walsummary",
			"pgbench",
			"postgres",
			"psql",
			"reindexdb",
			"vacuumdb",
		],
		libraries: ["ecpg", "ecpg_compat", "pgtypes", "pq"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:e0630a3600aea27511715563259ec2111cd5f4353a4b040e0be827f94cd7a8b0";
	const extension = ".tar.bz2";
	const base = `https://ftp.postgresql.org/pub/source/v${version}`;
	const output = await std.download
		.extractArchive({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);

	return await std.patch(output, patches);
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		icu?: std.args.DependencyArg<icu.Arg>;
		lz4?: std.args.DependencyArg<lz4.Arg>;
		ncurses?: std.args.DependencyArg<ncurses.Arg>;
		openssl?: std.args.DependencyArg<openssl.Arg>;
		readline?: std.args.DependencyArg<readline.Arg>;
		zlib?: std.args.DependencyArg<zlib.Arg>;
		zstd?: std.args.DependencyArg<zstd.Arg>;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: dependencyArgs = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const os = std.triple.os(host);

	const processDependency = (dep: any) =>
		std.env.envArgFromDependency(build, env_, host, sdk, dep);

	const icuArtifact = await processDependency(
		std.env.runtimeDependency(icu.build, dependencyArgs.icu),
	);
	const opensslArtifact = await processDependency(
		std.env.runtimeDependency(openssl.build, dependencyArgs.openssl),
	);
	const lz4Artifact = await processDependency(
		std.env.runtimeDependency(lz4.build, dependencyArgs.lz4),
	);
	const ncursesArtifact = await processDependency(
		std.env.runtimeDependency(ncurses.build, dependencyArgs.ncurses),
	);
	const readlineArtifact = await processDependency(
		std.env.runtimeDependency(readline.build, dependencyArgs.readline),
	);
	const zlibArtifact = await processDependency(
		std.env.runtimeDependency(zlib.build, dependencyArgs.zlib),
	);
	const zstdArtifact = await processDependency(
		std.env.runtimeDependency(zstd.build, dependencyArgs.zstd),
	);

	const flexArtifact = await processDependency(
		std.env.buildDependency(flex.build),
	);

	const env: tg.Unresolved<Array<std.env.Arg>> = [
		icuArtifact,
		lz4Artifact,
		ncursesArtifact,
		opensslArtifact,
		flexArtifact,
		readlineArtifact,
		zlibArtifact,
		zstdArtifact,
		env_,
	];

	const sourceDir = source_ ?? source();

	const configureArgs: tg.Unresolved<Array<tg.Template.Arg>> = [
		"--disable-rpath",
		"--with-lz4",
		"--with-zstd",
	];

	if (os === "darwin") {
		configureArgs.push(
			"DYLD_FALLBACK_LIBRARY_PATH=$DYLD_FALLBACK_LIBRARY_PATH",
		);
		env.push({
			LDFLAGS_SL: tg.Mutation.suffix("-Wl,-undefined,dynamic_lookup", " "),
		});
	}

	const configure = {
		args: configureArgs,
	};
	const phases = { configure };

	let libraryDirs = [
		icuArtifact,
		ncursesArtifact,
		opensslArtifact,
		readlineArtifact,
		lz4Artifact,
		zlibArtifact,
		zstdArtifact,
	];

	let libraryLibDirs = libraryDirs
		.filter((v) => v !== undefined)
		.map((dir) => dir.get("lib").then(tg.Directory.expect));
	let libraryIncludeDirs = libraryDirs
		.filter((v) => v !== undefined)
		.map((dir) => dir.get("include").then(tg.Directory.expect));

	if (build !== host) {
		// For cross, the library directories must be explicitly enumerated.
		let libDirTemplate = libraryLibDirs.reduce(
			(acc, el) => tg.Template.join(":", acc, el),
			tg``,
		);
		let includeDirTemplate = libraryIncludeDirs.reduce(
			(acc, el) => tg.Template.join(":", acc, el),
			tg``,
		);
		configureArgs.push(
			tg`--with-libraries=${libDirTemplate}`,
			tg`--with-includes=${includeDirTemplate}`,
			"--without-icu",
		);
		// For cross builds, we must provide `zic` for the build machine.
		const tzdbArtifact = tzdb.build({ build, host: build });
		env.push(tzdbArtifact);
	}

	let parallel = os !== "darwin";

	return await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(...env),
			parallel,
			phases,
			sdk,
			setRuntimeLibraryPath: true,
			source: sourceDir,
		},
		autotools,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
