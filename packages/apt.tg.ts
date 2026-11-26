import * as berkeleyDb from "berkeley-db" with {
	source: "./berkeley-db.tg.ts",
};
import * as bzip2 from "bzip2" with { source: "./bzip2" };
import * as cmake from "cmake" with { source: "./cmake" };
import * as dpkg from "dpkg" with { source: "./dpkg.tg.ts" };
import * as lz4 from "lz4" with { source: "./lz4.tg.ts" };
import * as openssl from "openssl" with { source: "./openssl.tg.ts" };
import * as std from "std" with { source: "./std" };
import { $ } from "std" with { source: "./std" };
import * as triehash from "triehash" with { source: "./triehash.tg.ts" };
import * as xxhash from "xxhash" with { source: "./xxhash.tg.ts" };
import * as xz from "xz" with { source: "./xz.tg.ts" };
import * as zlib from "zlib-ng" with { source: "./zlib-ng.tg.ts" };
import * as zstd from "zstd" with { source: "./zstd.tg.ts" };

export const metadata = {
	builds: {
		exports: ["default", "build"],
		hosts: ["aarch64-linux", "x86_64-linux"],
	},
	homepage: "https://wiki.debian.org/Apt",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-2.0-or-later",
	name: "apt",
	repository: "https://salsa.debian.org/apt-team/apt",
	version: "3.3.8",
	tag: "apt/3.3.8",
	provides: {
		binaries: ["apt-ftparchive"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:4bd35233f8fda514d88f36cb17dffd35d4f0ffbe4b14b381c6456820ace31451";
	return std
		.download({
			url: `https://deb.debian.org/debian/pool/main/a/${name}/${name}_${version}.tar.xz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export function deps() {
	return std.deps({
		berkeleyDb: berkeleyDb.build,
		bzip2: bzip2.build,
		lz4: lz4.build,
		openssl: openssl.build,
		triehash: { build: triehash.build, kind: "buildtime" },
		xxhash: xxhash.build,
		xz: xz.build,
		zlib: zlib.build,
		zstd: zstd.build,
	});
}

export type Arg = cmake.BuildArg & std.deps.Arg<typeof deps>;

export async function build(...args: tg.Args<Arg>) {
	// Build only `apt-ftparchive` and the libraries it links, which generate the indexes of a repository. The package manager, its download methods, the documentation, the tests, and the translations are left out.
	const arg = await cmake.arg(
		{
			deps,
			source: source(),
			phases: {
				configure: {
					args: [
						"-DCMAKE_BUILD_TYPE=Release",
						"-DCURRENT_VENDOR=debian",
						"-DUSE_NLS=OFF",
						"-DWITH_DOC=OFF",
						"-DWITH_HEGEL_TESTS=OFF",
						"-DWITH_TESTS=OFF",
					],
				},
				build: {
					args: ["--target", "apt-ftparchive"],
				},
				install: tg`
					cmake --install build/apt-pkg
					cmake --install build/apt-private
					cmake --install build/ftparchive
				`,
			},
		},
		...args,
	);
	std.assert.supportedHost(arg.host, metadata);

	// Point the Berkeley DB lookup at the dependency, since it searches only fixed include directories, and set the values that the configuration otherwise asks a Debian system for: the architecture tables of dpkg, the architecture, and the group of root.
	const artifacts = await std.deps.artifacts(deps, {
		build: arg.build,
		host: arg.host,
	});
	const berkeleyDbArtifact = artifacts.berkeleyDb;
	tg.assert(berkeleyDbArtifact !== undefined);
	const dpkgArtifact = await dpkg.build({ build: arg.build, host: arg.host });
	const architecture =
		std.triple.arch(arg.host) === "aarch64" ? "arm64" : "amd64";
	const configureArgs = [
		tg`-DBERKELEY_INCLUDE_DIRS=${berkeleyDbArtifact}/include`,
		`-DCOMMON_ARCH=${architecture}`,
		tg`-DDPKG_DATADIR=${dpkgArtifact}/share/dpkg`,
		"-DROOT_GROUP=root",
	];

	// The linker needs rpath-link to find the libraries that libapt-pkg links when it links the program.
	const libDirs = Object.values(artifacts)
		.filter((artifact): artifact is tg.Directory => artifact !== undefined)
		.map((artifact) => tg`${artifact}/lib`);
	const env = std.env.arg(arg.env ?? null, {
		LDFLAGS: tg.Mutation.suffix(
			tg`-Wl,-rpath-link,${tg.Template.join(":", ...libDirs)}`,
			" ",
		),
	});
	return cmake.build(
		{ ...arg, env },
		{ phases: { configure: { args: configureArgs } } },
	);
}

export default build;

export async function test() {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.binaries(metadata.provides.binaries, {
			"apt-ftparchive": {
				testArgs: ["--help"],
				snapshot: `apt ${metadata.version}`,
			},
		}),
	};
	await std.assert.pkg(build, spec);

	// Index a directory that contains a package and write its release file with by-hash, as the Tangram release does.
	const packages = await dpkg.testPackage();
	const output = await $`
		set -eu
		mkdir repo
		cp ${packages}/hello_1.0.0_amd64.deb repo/
		cd repo
		apt-ftparchive packages . > Packages
		gzip -nc Packages > Packages.gz
		apt-ftparchive -o APT::FTPArchive::Release::Origin=Tangram \
			-o APT::FTPArchive::Release::Acquire-By-Hash=yes \
			-o APT::FTPArchive::Release::Suite=stable release . > ../Release
		mkdir -p ${tg.output}
		cp Packages ../Release ${tg.output}/
	`
		.env(build())
		.then(tg.Directory.expect);
	const packagesIndex = await output
		.get("Packages")
		.then(tg.File.expect)
		.then((file) => file.text);
	for (const line of [
		"Package: hello",
		"Version: 1.0.0",
		"Architecture: amd64",
		"Filename: ./hello_1.0.0_amd64.deb",
	]) {
		tg.assert(
			packagesIndex.split("\n").includes(line),
			`the Packages index is missing "${line}": ${packagesIndex}`,
		);
	}
	tg.assert(/^SHA256: [0-9a-f]{64}$/m.test(packagesIndex));
	const release = await output
		.get("Release")
		.then(tg.File.expect)
		.then((file) => file.text);
	for (const line of [
		"Origin: Tangram",
		"Suite: stable",
		"Acquire-By-Hash: yes",
	]) {
		tg.assert(
			release.split("\n").includes(line),
			`the Release file is missing "${line}": ${release}`,
		);
	}
	tg.assert(/^ [0-9a-f]{64} +\d+ Packages\.gz$/m.test(release));
	return true;
}
