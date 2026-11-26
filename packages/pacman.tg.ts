import * as bash from "bash" with { source: "./bash.tg.ts" };
import * as bzip2 from "bzip2" with { source: "./bzip2" };
import * as libarchive from "libarchive" with { source: "./libarchive.tg.ts" };
import * as meson from "meson" with { source: "./meson.tg.ts" };
import * as openssl from "openssl" with { source: "./openssl.tg.ts" };
import * as python from "python" with { source: "./python" };
import * as std from "std" with { source: "./std" };
import { $ } from "std" with { source: "./std" };
import * as xz from "xz" with { source: "./xz.tg.ts" };
import * as zlib from "zlib-ng" with { source: "./zlib-ng.tg.ts" };

export const metadata = {
	builds: {
		exports: ["default", "build"],
		hosts: ["aarch64-linux", "x86_64-linux"],
	},
	homepage: "https://pacman.archlinux.page",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-2.0-or-later",
	name: "pacman",
	repository: "https://gitlab.archlinux.org/pacman/pacman",
	version: "7.1.0",
	tag: "pacman/7.1.0",
	provides: {
		binaries: ["makepkg", "pacman"],
		libraries: [{ name: "alpm", pkgConfigName: "libalpm", staticlib: false }],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:530e50d7edbb2a22581c6d6707d2113240276c1bec4ee39a99488e1243c32171";
	return std
		.download({
			url: `https://gitlab.archlinux.org/pacman/${name}/-/releases/v${version}/downloads/${name}-${version}.tar.xz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export function deps() {
	return std.deps({
		libarchive: libarchive.build,
		openssl: openssl.build,
		python: { build: python.self, kind: "buildtime" },
	});
}

export type Arg = meson.BuildArg & std.deps.Arg<typeof deps>;

export async function build(...args: tg.Args<Arg>) {
	// The configuration needs Python. Install the configuration in the package rather than in `/etc`, and leave out the documentation, the translations, the downloads with curl, the signature checks with GPGME, and the seccomp filter of the file command.
	const resolved = await meson.arg(
		{
			deps,
			source: source(),
			phases: {
				configure: {
					args: [
						"-Dcrypto=openssl",
						"-Dcurl=disabled",
						"-Ddoc=disabled",
						"-Dfile-seccomp=disabled",
						"-Dgpgme=disabled",
						"-Di18n=false",
						"-Dlocalstatedir=var",
						"-Dsysconfdir=etc",
					],
				},
			},
		},
		...args,
	);
	std.assert.supportedHost(resolved.host, metadata);

	// The linker needs rpath-link to find the libraries that libarchive links when it links the programs.
	const host = { build: resolved.build, host: resolved.host };
	const libDirs = [
		libarchive.build(host),
		openssl.build(host),
		bzip2.build(host),
		xz.build(host),
		zlib.build(host),
	].map((artifact) => tg`${artifact}/lib`);
	const env = std.env.arg(resolved.env ?? null, {
		LDFLAGS: tg.Mutation.suffix(
			tg`-Wl,-rpath-link,${tg.Template.join(":", ...libDirs)}`,
			" ",
		),
	});
	const output = await meson.build({ ...resolved, env });

	// Run makepkg with bash, and point it at its library and configuration wherever the package is.
	const bashArtifact = await bash.build({
		build: resolved.build,
		host: resolved.host,
	});
	const interpreter = tg.symlink({ artifact: bashArtifact, path: "bin/bash" });
	const makepkg = await output.get("bin/makepkg").then(tg.File.expect);
	const wrappedMakepkg = std.wrap(makepkg, {
		env: {
			MAKEPKG_CONF: tg.Mutation.setIfUnset(tg`${output}/etc/makepkg.conf`),
			MAKEPKG_LIBRARY: tg.Mutation.setIfUnset(tg`${output}/share/makepkg`),
		},
		host: resolved.host,
		interpreter,
	});

	return tg.directory(output, {
		["bin/makepkg"]: wrappedMakepkg,
	});
}

export default build;

export async function test() {
	const runtimeDeps = [
		bzip2.build(),
		libarchive.build(),
		openssl.build(),
		xz.build(),
		zlib.build(),
	];
	const spec: std.assert.PackageSpec = {
		...std.assert.defaultSpec(metadata),
		libraries: metadata.provides.libraries.map((library) => ({
			...library,
			runtimeDeps,
		})),
		binaries: std.assert.binaries(metadata.provides.binaries, {
			makepkg: { snapshot: `makepkg (pacman) ${metadata.version}` },
			pacman: { snapshot: `Pacman v${metadata.version}` },
		}),
	};
	await std.assert.pkg(build, spec);

	// Print the source information of a recipe, as the Tangram release does for the AUR.
	const recipe = tg.file(`pkgname=hello-bin
pkgver=1.0.0
pkgrel=1
pkgdesc='A test package'
arch=('aarch64' 'x86_64')
url='https://tangram.dev'
license=('MIT')
depends=('glibc')
backup=('etc/hello/hello.conf')
options=('!debug' '!strip')
source=('hello.conf')
sha256sums=('0000000000000000000000000000000000000000000000000000000000000000')
source_x86_64=('https://example.com/hello_x86_64.tar.gz')
sha256sums_x86_64=('1111111111111111111111111111111111111111111111111111111111111111')

package() {
	install -Dm644 hello.conf "$pkgdir/etc/hello/hello.conf"
}
`);
	const srcinfo = await $`
		set -eu
		mkdir package
		cp ${recipe} package/PKGBUILD
		cd package
		BUILDDIR=$PWD PKGDEST=$PWD SRCDEST=$PWD makepkg --printsrcinfo > ${tg.output}
	`
		.env(build())
		.then(tg.File.expect)
		.then((file) => file.text);
	for (const line of [
		"pkgbase = hello-bin",
		"\tpkgver = 1.0.0",
		"\tarch = x86_64",
		"\tbackup = etc/hello/hello.conf",
		"\tsource_x86_64 = https://example.com/hello_x86_64.tar.gz",
		"pkgname = hello-bin",
	]) {
		tg.assert(
			srcinfo.split("\n").includes(line),
			`the source information is missing "${line}": ${srcinfo}`,
		);
	}
	return true;
}
