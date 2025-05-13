import * as flex from "flex" with { path: "../flex" };
import * as icu from "icu" with { path: "../icu" };
import * as lz4 from "lz4" with { path: "../lz4" };
import * as ncurses from "ncurses" with { path: "../ncurses" };
import * as openssl from "openssl" with { path: "../openssl" };
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
	version: "16.6",
	provides: {
		binaries: ["postgres", "psql"],
		libraries: ["pq"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:23369cdaccd45270ac5dcc30fa9da205d5be33fa505e1f17a0418d2caeca477b";
	const extension = ".tar.bz2";
	const base = `https://ftp.postgresql.org/pub/source/v${version}`;
	let output = await std.download
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

	const configureArgs = ["--disable-rpath", "--with-lz4", "--with-zstd"];
	if (os === "darwin") {
		configureArgs.push(
			"DYLD_FALLBACK_LIBRARY_PATH=$DYLD_FALLBACK_LIBRARY_PATH",
		);
	}

	const configure = {
		args: configureArgs,
	};
	const phases = { configure };

	if (os === "darwin") {
		env.push({
			CC: "gcc",
			CXX: "g++",
		});
	}

	let output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(...env),
			phases,
			sdk,
			setRuntimeLibraryPath: true,
			source: sourceDir,
		},
		autotools,
	);

	let libraryPaths = [
		icuArtifact,
		ncursesArtifact,
		opensslArtifact,
		readlineArtifact,
		lz4Artifact,
		zlibArtifact,
		zstdArtifact,
	]
		.filter((v) => v !== undefined)
		.map((dir) => dir.get("lib").then(tg.Directory.expect));
	libraryPaths.push(output.get("lib").then(tg.Directory.expect));

	let binDir = await output.get("bin").then(tg.Directory.expect);
	for await (let [name, artifact] of binDir) {
		let file = tg.File.expect(artifact);
		let wrappedBin = await std.wrap(file, { libraryPaths });
		output = await tg.directory(output, { [`bin/${name}`]: wrappedBin });
	}

	return output;
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
