import optionalManpagesTranslations from "./rpm-optional-manpages-translations.patch" with { type: "file" };
import * as bzip2 from "bzip2" with { source: "./bzip2" };
import * as cmake from "cmake" with { source: "./cmake" };
import * as elfutils from "elfutils" with { source: "./elfutils.tg.ts" };
import * as file from "file" with { source: "./file.tg.ts" };
import * as libarchive from "libarchive" with { source: "./libarchive.tg.ts" };
import * as libcap from "libcap" with { source: "./libcap.tg.ts" };
import * as lua from "lua" with { source: "./lua.tg.ts" };
import * as openssl from "openssl" with { source: "./openssl.tg.ts" };
import * as popt from "popt" with { source: "./popt.tg.ts" };
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
	homepage: "https://rpm.org",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-2.0-or-later",
	name: "rpm",
	repository: "https://github.com/rpm-software-management/rpm",
	version: "6.1.0",
	tag: "rpm/6.1.0",
	provides: {
		binaries: ["rpm", "rpmbuild", "rpmdb", "rpmkeys", "rpmsign", "rpmspec"],
		headers: ["rpm/rpmlib.h"],
		libraries: [
			{ name: "rpm", staticlib: false },
			{ name: "rpmbuild", pkgConfigName: false, staticlib: false },
			{ name: "rpmio", pkgConfigName: false, staticlib: false },
			{ name: "rpmsign", pkgConfigName: false, staticlib: false },
		],
	},
};

export async function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:f520810d27c74bf1c5d8b8885845c61e0c845f62d33e68b02e020633a8b62fe3";
	const series = version.split(".").slice(0, 2).join(".");
	const source = await std
		.download({
			url: `https://ftp.osuosl.org/pub/rpm/releases/${name}-${series}.x/${name}-${version}.tar.bz2`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
	return std.patch(source, optionalManpagesTranslations);
}

export function deps() {
	return std.deps({
		bzip2: bzip2.build,
		elfutils: elfutils.build,
		file: file.build,
		libarchive: libarchive.build,
		libcap: libcap.build,
		lua: lua.build,
		openssl: openssl.build,
		popt: popt.build,
		sqlite: sqlite.build,
		xz: xz.build,
		zlib: zlib.build,
		zstd: zstd.build,
	});
}

export type Arg = cmake.BuildArg & std.deps.Arg<typeof deps>;

export async function build(...args: tg.Args<Arg>) {
	// Use OpenSSL for digests and the dummy OpenPGP backend instead of Sequoia, so that the build needs neither Rust nor libgcrypt. Packages build, install, and query normally, but signatures cannot be created or verified. Leave out the manual pages, which need scdoc, the Python bindings, the plugins, OpenMP, the translations, and the integrations with SELinux, D-Bus, audit, fapolicyd, ACLs, and readline.
	const arg = await cmake.arg(
		{
			deps,
			source: source(),
			phases: {
				configure: {
					args: [
						"-DCMAKE_BUILD_TYPE=Release",
						"-DENABLE_NLS=OFF",
						"-DENABLE_OPENMP=OFF",
						"-DENABLE_PLUGINS=OFF",
						"-DENABLE_PYTHON=OFF",
						"-DENABLE_TESTSUITE=OFF",
						"-DWITH_ACL=OFF",
						"-DWITH_AUDIT=OFF",
						"-DWITH_DBUS=OFF",
						"-DWITH_FAPOLICYD=OFF",
						"-DWITH_OPENSSL=ON",
						"-DWITH_READLINE=OFF",
						"-DWITH_SELINUX=OFF",
						"-DWITH_SEQUOIA=OFF",
					],
				},
				fixup: await fixup(),
			},
		},
		...args,
	);
	std.assert.supportedHost(arg.host, metadata);

	// The linker needs rpath-link to find the libraries that librpm and librpmio link when it links the programs.
	const artifacts = await std.deps.artifacts(deps, {
		build: arg.build,
		host: arg.host,
	});
	const libDirs = Object.values(artifacts)
		.filter((artifact): artifact is tg.Directory => artifact !== undefined)
		.map((artifact) => tg`${artifact}/lib`);
	const env = std.env.arg(arg.env ?? null, {
		LDFLAGS: tg.Mutation.suffix(
			tg`-Wl,-rpath-link,${tg.Template.join(":", ...libDirs)}`,
			" ",
		),
	});
	const output = await cmake.build({ ...arg, env });

	// Wrap the compiled programs, so that they find their configuration through `RPM_CONFIGDIR` wherever the package is, and so that librpmbuild finds the magic database of libmagic.
	const magic = await file
		.build({ build: arg.build, host: arg.host })
		.then((directory) => directory.get("share/misc/magic.mgc"))
		.then(tg.File.expect);
	const configDir = tg`${output}/lib/rpm`;
	const libDir = await output.get("lib").then(tg.Directory.expect);
	const bin = await output.get("bin").then(tg.Directory.expect);
	const wrapped: Record<string, tg.Unresolved<tg.File>> = {};
	for await (const [name, artifact] of bin) {
		if (
			!(artifact instanceof tg.File) ||
			(await std.file.detectExecutableKind(artifact)) !== "elf"
		) {
			continue;
		}
		wrapped[`bin/${name}`] = std.wrap(artifact, {
			env: {
				MAGIC: tg.Mutation.setIfUnset(tg`${magic}`),
				RPM_CONFIGDIR: tg.Mutation.setIfUnset(configDir),
			},
			host: arg.host,
			libraryPaths: [libDir],
		});
	}

	return tg.directory(output, wrapped);
}

export default build;

/** Rewrite the paths in the installed macros and pkg-config files. The platform paths that packages install into become the usual `/usr`, `/etc`, and `/var` paths, where GNUInstallDirs puts the configuration of a prefix under `/opt` in `/etc/opt` and `/var/opt`, rpmuncompress is found relative to the configuration directory, the helper scripts find bash on the `PATH`, and the external tools that the build scripts run are found on the `PATH` instead of at absolute paths that the build machine may lack. */
async function fixup() {
	const pkgConfigFixup = await std.pkgconfig.shellNormalizeCommand();
	return tg`
		set -eu
		${pkgConfigFixup}
		sed -i \
			-e 's|^rpmhome=.*|rpmhome=$'"{libdir}"'/rpm|' \
			-e 's|^rpmplugindir=.*|rpmplugindir=$'"{libdir}"'/rpm-plugins|' \
			${tg.output}/lib/pkgconfig/rpm.pc
		cd ${tg.output}/lib/rpm
		for script in $(grep -I -l -r '^#!/bin/bash' . || true); do
			sed -i '1s|^#!/bin/bash|#!/usr/bin/env bash|' "$script"
		done
		for macros in macros platform/*/macros; do
			sed -i \
				-e 's|^%__rpmuncompress.*$|%__rpmuncompress\t%{_rpmconfigdir}/../../bin/rpmuncompress|' \
				-e 's|^%__plugindir.*$|%__plugindir\t\t%{_rpmconfigdir}/../rpm-plugins|' \
				-e 's|/etc${tg.output}|/etc|g' \
				-e 's|/var${tg.output}|/var|g' \
				-e 's|${tg.output}/com|/var/lib|g' \
				-e 's|${tg.output}|/usr|g' \
				-e 's|^\\(%__[A-Za-z0-9_]*[[:space:]]*\\)/usr/bin/|\\1|' \
				-e 's|^%_buildshell.*$|%_buildshell\t\tsh|' \
				"$macros"
		done
		if grep -rn '${tg.output}' macros platform/*/macros ${tg.output}/lib/pkgconfig; then
			echo "the macros still reference the build output" >&2
			exit 1
		fi
	`;
}

export async function test() {
	const runtimeDeps = [
		bzip2.build(),
		elfutils.build(),
		file.build(),
		libarchive.build(),
		libcap.build(),
		openssl.build(),
		popt.build(),
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
	const output = await testPackage();
	const info = await output
		.get("info")
		.then(tg.File.expect)
		.then((file) => file.text);
	tg.assert(/^Name +: hello$/m.test(info), `unexpected info: ${info}`);
	tg.assert(/^Version +: 1\.0\.0$/m.test(info), `unexpected info: ${info}`);
	tg.assert(/^Signature +: \(none\)$/m.test(info), `unexpected info: ${info}`);
	const files = await output
		.get("files")
		.then(tg.File.expect)
		.then((file) => file.text);
	tg.assert(
		files === "/etc/hello/hello.conf\n/usr/bin/hello\n",
		`unexpected files: ${files}`,
	);
	const installed = await output
		.get("installed")
		.then(tg.File.expect)
		.then((file) => file.text);
	tg.assert(
		installed.trim() === "hello-1.0.0-1.x86_64",
		`unexpected installed packages: ${installed}`,
	);
	return true;
}

/** Build a tiny package from a spec with prebuilt files, as the Tangram release does, read it back, and record it in a new database without verifying a signature, since the package is unsigned and this build has no OpenPGP backend. The output contains the package at `hello-1.0.0-1.x86_64.rpm`. */
export async function testPackage() {
	const specFile = tg.file(`%global _rpmformat 4
%global _binary_payload w6.gzdio
%global __spec_install_post %{nil}
%global _build_id_links none
%global debug_package %{nil}
%global source_date_epoch_from_changelog 0

Name: hello
Version: 1.0.0
Release: 1
Summary: A test package
License: MIT
URL: https://tangram.dev
Source0: hello
Source1: hello.conf

%description
A test package.

%install
install -Dm755 "%{SOURCE0}" "%{buildroot}%{_bindir}/hello"
install -Dm644 "%{SOURCE1}" "%{buildroot}%{_sysconfdir}/hello/hello.conf"

%files
%{_bindir}/hello
%dir %{_sysconfdir}/hello
%config(noreplace) %{_sysconfdir}/hello/hello.conf
`);
	return await $`
		set -eu
		top=$PWD/rpmbuild
		mkdir -p "$top/SOURCES" "$top/tmp"
		printf '#!/bin/sh\necho hello\n' > "$top/SOURCES/hello"
		printf 'greeting = hello\n' > "$top/SOURCES/hello.conf"
		cp ${specFile} hello.spec
		rpmbuild --define "_topdir $top" --define "_tmppath $top/tmp" --target x86_64 -bb hello.spec
		mkdir -p ${tg.output}
		package=$top/RPMS/x86_64/hello-1.0.0-1.x86_64.rpm
		cp "$package" ${tg.output}/hello-1.0.0-1.x86_64.rpm
		rpm -qp --info "$package" > ${tg.output}/info
		rpm -qp --list "$package" | grep -v '^/etc/hello$' > ${tg.output}/files
		rpmdb --dbpath "$PWD/db" --initdb
		rpm --dbpath "$PWD/db" --nodeps --nosignature --noscripts --justdb -i "$package"
		rpm --dbpath "$PWD/db" -qa > ${tg.output}/installed
	`
		.env(build())
		.then(tg.Directory.expect);
}
