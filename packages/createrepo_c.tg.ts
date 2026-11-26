import * as bzip2 from "bzip2" with { source: "./bzip2" };
import * as cmake from "cmake" with { source: "./cmake" };
import * as curl from "curl" with { source: "./curl.tg.ts" };
import * as glib from "glib" with { source: "./glib.tg.ts" };
import * as libcap from "libcap" with { source: "./libcap.tg.ts" };
import * as libffi from "libffi" with { source: "./libffi.tg.ts" };
import * as libpsl from "libpsl" with { source: "./libpsl.tg.ts" };
import * as libxml2 from "libxml2" with { source: "./libxml2.tg.ts" };
import * as openssl from "openssl" with { source: "./openssl.tg.ts" };
import * as pcre2 from "pcre2" with { source: "./pcre2.tg.ts" };
import * as popt from "popt" with { source: "./popt.tg.ts" };
import * as rpm from "rpm" with { source: "./rpm.tg.ts" };
import * as sqlite from "sqlite" with { source: "./sqlite.tg.ts" };
import * as std from "std" with { source: "./std" };
import { $ } from "std" with { source: "./std" };
import * as xz from "xz" with { source: "./xz.tg.ts" };
import * as zlib from "zlib-ng" with { source: "./zlib-ng.tg.ts" };
import * as zstd from "zstd" with { source: "./zstd.tg.ts" };

export const metadata = {
	builds: {
		exports: ["default", "build"],
		hosts: ["aarch64-linux", "x86_64-linux"],
	},
	homepage: "https://rpm-software-management.github.io/createrepo_c/",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-2.0-or-later",
	name: "createrepo_c",
	repository: "https://github.com/rpm-software-management/createrepo_c",
	version: "1.2.6",
	tag: "createrepo_c/1.2.6",
	provides: {
		binaries: ["createrepo_c", "mergerepo_c", "modifyrepo_c", "sqliterepo_c"],
		libraries: [{ name: "createrepo_c", staticlib: false }],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:21d068aac366052d6de56d7f92aa58322547b5e4adaebdc001d1bb0a8dd260ce";
	return std.download.fromGithub({
		checksum,
		owner: "rpm-software-management",
		repo: name,
		source: "tag",
		tag: version,
	});
}

export function deps() {
	return std.deps({
		bzip2: bzip2.build,
		curl: curl.build,
		glib: glib.build,
		libffi: libffi.build,
		libxml2: libxml2.build,
		openssl: openssl.build,
		pcre2: pcre2.build,
		popt: popt.build,
		rpm: rpm.build,
		sqlite: sqlite.build,
		xz: xz.build,
		zlib: zlib.build,
		zstd: zstd.build,
	});
}

export type Arg = cmake.BuildArg & std.deps.Arg<typeof deps>;

export async function build(...args: tg.Args<Arg>) {
	// The pkg-config files of glib and rpm require libffi, pcre2, and popt. Configure a writable copy of the source, since the project writes generated headers into its source directory. Leave out the Python bindings, the documentation, the bash completions, delta RPMs, zchunk, and libmodulemd.
	const sourceDir = await source();
	const arg = await cmake.arg(
		{
			deps,
			source: sourceDir,
			phases: {
				prepare: tg`cp -R ${sourceDir}/. source && chmod -R u+w source`,
				configure: {
					args: [
						"-S",
						"source",
						"-DCMAKE_BUILD_TYPE=Release",
						"-DBUILD_DOC_C=OFF",
						"-DENABLE_BASHCOMP=OFF",
						"-DENABLE_DRPM=OFF",
						"-DENABLE_PYTHON=OFF",
						"-DWITH_LIBMODULEMD=OFF",
						"-DWITH_ZCHUNK=OFF",
					],
				},
				fixup: await std.pkgconfig.shellNormalizeCommand(),
			},
		},
		...args,
	);
	std.assert.supportedHost(arg.host, metadata);

	// The linker needs rpath-link to find the libraries that the shared libraries of the dependencies link, including those of curl and rpm that are not dependencies here.
	const host = { build: arg.build, host: arg.host };
	const artifacts = await std.deps.artifacts(deps, host);
	const indirect = await Promise.all([libcap.build(host), libpsl.build(host)]);
	const libDirs = [
		...Object.values(artifacts).filter(
			(artifact): artifact is tg.Directory => artifact !== undefined,
		),
		...indirect,
	].map((artifact) => tg`${artifact}/lib`);
	const env = std.env.arg(arg.env ?? null, {
		LDFLAGS: tg.Mutation.suffix(
			tg`-Wl,-rpath-link,${tg.Template.join(":", ...libDirs)}`,
			" ",
		),
	});
	const output = await cmake.build({ ...arg, env });

	// Wrap the programs, so that librpm finds the configuration of the rpm package.
	const rpmArtifact = artifacts.rpm;
	tg.assert(rpmArtifact !== undefined);
	const libDir = await output.get("lib").then(tg.Directory.expect);
	const wrapped: Record<string, tg.Unresolved<tg.File>> = {};
	for (const name of metadata.provides.binaries) {
		const executable = await output.get(`bin/${name}`).then(tg.File.expect);
		wrapped[`bin/${name}`] = std.wrap(executable, {
			env: {
				RPM_CONFIGDIR: tg.Mutation.setIfUnset(tg`${rpmArtifact}/lib/rpm`),
			},
			host: arg.host,
			libraryPaths: [libDir],
		});
	}

	return tg.directory(output, wrapped);
}

export default build;

export async function test() {
	const runtimeDeps = [
		bzip2.build(),
		curl.build(),
		glib.build(),
		libcap.build(),
		libffi.build(),
		libpsl.build(),
		libxml2.build(),
		openssl.build(),
		pcre2.build(),
		popt.build(),
		rpm.build(),
		sqlite.build(),
		xz.build(),
		zlib.build(),
		zstd.build(),
	];
	const spec: std.assert.PackageSpec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.allBinaries(metadata.provides.binaries, {
			snapshot: metadata.version,
		}),
		libraries: metadata.provides.libraries.map((library) => ({
			...library,
			runtimeDeps,
		})),
	};
	await std.assert.pkg(build, spec);

	// Index a directory that contains an unsigned package, as the Tangram release does, and read the package back from the metadata.
	const packages = await rpm.testPackage();
	const output = await $`
		set -eu
		mkdir repo
		cp ${packages}/hello-1.0.0-1.x86_64.rpm repo/
		createrepo_c repo
		mkdir -p ${tg.output}
		cp repo/repodata/repomd.xml ${tg.output}/repomd.xml
		primary=$(ls repo/repodata/*-primary.xml.zst)
		zstd -dc "$primary" > ${tg.output}/primary.xml
	`
		.env(build(), zstd.build())
		.then(tg.Directory.expect);
	const repomd = await output
		.get("repomd.xml")
		.then(tg.File.expect)
		.then((file) => file.text);
	tg.assert(
		repomd.includes('<data type="primary">'),
		`unexpected repomd.xml: ${repomd}`,
	);
	const primary = await output
		.get("primary.xml")
		.then(tg.File.expect)
		.then((file) => file.text);
	tg.assert(
		primary.includes('<metadata xmlns="http://linux.duke.edu/metadata/common"'),
		`unexpected primary.xml: ${primary}`,
	);
	tg.assert(primary.includes("<name>hello</name>"));
	tg.assert(primary.includes('<version epoch="0" ver="1.0.0" rel="1"/>'));
	tg.assert(primary.includes('<location href="hello-1.0.0-1.x86_64.rpm"/>'));
	return true;
}
