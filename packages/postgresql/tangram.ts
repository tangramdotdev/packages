import * as flex from "flex" with { local: "../flex.tg.ts" };
import * as icu from "icu" with { local: "../icu.tg.ts" };
import * as lz4 from "lz4" with { local: "../lz4.tg.ts" };
import * as ncurses from "ncurses" with { local: "../ncurses.tg.ts" };
import * as openssl from "openssl" with { local: "../openssl.tg.ts" };
import * as readline from "readline" with { local: "../readline.tg.ts" };
import * as std from "std" with { local: "../std" };
import * as tzdb from "tzdb" with { local: "../tzdb.tg.ts" };
import * as zlib from "zlib-ng" with { local: "../zlib-ng.tg.ts" };
import * as zstd from "zstd" with { local: "../zstd.tg.ts" };

import patches from "./patches" with { type: "directory" };

export const metadata = {
	homepage: "https://www.postgresql.org",
	license: "https://www.postgresql.org/about/licence/",
	name: "postgresql",
	repository: "https://git.postgresql.org/gitweb/?p=postgresql.git;a=summary",
	version: "18.0",
	tag: "postgresql/18.0",
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
		"sha256:0d5b903b1e5fe361bca7aa9507519933773eb34266b1357c4e7780fdee6d6078";
	const extension = ".tar.bz2";
	const base = `https://ftp.postgresql.org/pub/source/v${version}`;
	const output = await std.download
		.extractArchive({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
	// return output;
	return await std.patch(output, patches);
};

const deps = std.deps({
	flex: { build: flex.build, kind: "buildtime" },
	icu: icu.build,
	lz4: lz4.build,
	ncurses: ncurses.build,
	openssl: openssl.build,
	readline: readline.build,
	zlib: zlib.build,
	zstd: zstd.build,
});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{
			source: source(),
			deps,
		},
		...args,
	);

	const os = std.triple.os(arg.host);

	// Get individual artifacts for cross-compilation library paths.
	const artifacts = await std.deps.artifacts(deps, arg);
	const runtimeArtifacts = [
		artifacts.icu,
		artifacts.lz4,
		artifacts.ncurses,
		artifacts.openssl,
		artifacts.readline,
		artifacts.zlib,
		artifacts.zstd,
	].filter((v): v is tg.Directory => v !== undefined);

	const additionalEnv: tg.Unresolved<Array<std.env.Arg>> = [];

	const configureArgs: tg.Unresolved<Array<tg.Template.Arg>> = [
		"--disable-rpath",
		"--with-lz4",
		"--with-zstd",
	];

	if (os === "darwin") {
		configureArgs.push(
			"DYLD_FALLBACK_LIBRARY_PATH=$DYLD_FALLBACK_LIBRARY_PATH",
		);
		additionalEnv.push({
			LDFLAGS_SL: tg.Mutation.suffix("-Wl,-undefined,dynamic_lookup", " "),
		});
	}

	const configure = {
		args: configureArgs,
	};
	const phases = { configure };

	if (arg.build !== arg.host) {
		// For cross, the library directories must be explicitly enumerated.
		const libraryLibDirs = runtimeArtifacts.map((dir) =>
			dir.get("lib").then(tg.Directory.expect),
		);
		const libraryIncludeDirs = runtimeArtifacts.map((dir) =>
			dir.get("include").then(tg.Directory.expect),
		);
		const libDirTemplate = libraryLibDirs.reduce(
			(acc, el) => tg.Template.join(":", acc, el),
			tg``,
		);
		const includeDirTemplate = libraryIncludeDirs.reduce(
			(acc, el) => tg.Template.join(":", acc, el),
			tg``,
		);
		configureArgs.push(
			tg`--with-libraries=${libDirTemplate}`,
			tg`--with-includes=${includeDirTemplate}`,
			"--without-icu",
		);
		// For cross builds, we must provide `zic` for the build machine.
		const tzdbArtifact = tzdb.build({
			build: arg.build,
			host: arg.build,
		});
		additionalEnv.push(tzdbArtifact);
	}

	const parallel = os !== "darwin";

	return await std.autotools.build({
		...arg,
		env: std.env.arg(arg.env, ...additionalEnv),
		parallel,
		phases,
		setRuntimeLibraryPath: true,
	});
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
