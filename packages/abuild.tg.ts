import * as openssl from "openssl" with { source: "./openssl.tg.ts" };
import * as std from "std" with { source: "./std" };
import { $ } from "std" with { source: "./std" };
import * as zlib from "zlib-ng" with { source: "./zlib-ng.tg.ts" };

export const metadata = {
	builds: {
		exports: ["default", "build"],
		hosts: ["aarch64-linux", "x86_64-linux"],
	},
	homepage: "https://gitlab.alpinelinux.org/alpine/abuild",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-2.0-only",
	name: "abuild",
	repository: "https://gitlab.alpinelinux.org/alpine/abuild",
	version: "3.18.0",
	tag: "abuild/3.18.0",
	provides: {
		binaries: ["abuild-gzsplit", "abuild-tar"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:82aae4560cdf6572c4c4966e3384268b0052fc3c8d164d7f27549baf2d11a03a";
	return std
		.download({
			url: `https://gitlab.alpinelinux.org/alpine/${name}/-/archive/${version}/${name}-${version}.tar.gz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export function deps() {
	return std.deps({
		openssl: openssl.build,
		zlib: zlib.build,
	});
}

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export async function build(...args: tg.Args<Arg>) {
	// Build only the C programs that assemble packages. The shell scripts, such as abuild and abuild-sign, expect an Alpine system, and abuild-sudo, abuild-fetch, and abuild-rm manage one.
	const arg = await std.autotools.arg(
		{
			buildInTree: true,
			deps,
			order: ["prepare", "build", "install"],
			phases: {
				build: `make -j"$(nproc)" abuild-gzsplit abuild-tar`,
				install: tg`
					mkdir -p ${tg.output}/bin
					install -m 755 abuild-gzsplit abuild-tar ${tg.output}/bin
				`,
			},
			prefixArg: "none",
			source: source(),
		},
		...args,
	);
	std.assert.supportedHost(arg.host, metadata);
	return std.autotools.build(arg);
}

export default build;

export async function test() {
	const output = await testPackage();
	const contents = await output
		.get("contents")
		.then(tg.File.expect)
		.then((file) => file.text);
	tg.assert(
		contents === ".PKGINFO\nusr/\nusr/bin/\nusr/bin/hello\n",
		`unexpected contents: ${contents}`,
	);
	const headers = await output
		.get("headers")
		.then(tg.File.expect)
		.then((file) => file.text);
	tg.assert(
		headers.split("\n").filter((line) => line !== "").length === 1,
		`unexpected payload checksums: ${headers}`,
	);
	return true;
}

/** Build a tiny unsigned package as the Tangram release does, with `abuild-tar` writing the payload checksums, and split it back into its control and data streams with `abuild-gzsplit`. The output contains the package at `hello-1.0.0-r0.apk`. */
export async function testPackage() {
	return await $`
		set -eu
		umask 022
		cut_tar() {
			abuild-tar --cut "$@"
			cat >/dev/null
		}
		mkdir -p root/usr/bin
		printf '#!/bin/sh\necho hello\n' > root/usr/bin/hello
		chmod 755 root/usr/bin/hello
		(
			cd root
			find usr -print0 |
				LC_ALL=C sort -z |
				tar --format=pax --pax-option=exthdr.name=%d/PaxHeaders/%f,atime:=0,ctime:=0 \
					--owner=0 --group=0 --numeric-owner --blocking-factor=1 --null --no-recursion -cf - -T -
		) | {
			cut_tar --hash
			head -c 1024 /dev/zero
		} | gzip -n > data.tar.gz
		cat > .PKGINFO <<PKGINFO
pkgname = hello
pkgver = 1.0.0-r0
pkgdesc = A test package
url = https://tangram.dev
size = 1024
arch = x86_64
origin = hello
license = MIT
datahash = $(sha256sum data.tar.gz | cut -d ' ' -f 1)
PKGINFO
		tar --format=ustar --owner=0 --group=0 --numeric-owner --blocking-factor=1 -cf - .PKGINFO |
			cut_tar | gzip -n > control.tar.gz
		mkdir -p ${tg.output}
		cat control.tar.gz data.tar.gz > ${tg.output}/hello-1.0.0-r0.apk
		mkdir split
		cd split
		abuild-gzsplit < ${tg.output}/hello-1.0.0-r0.apk
		cmp control.tar.gz ../control.tar.gz
		cmp data.tar.gz ../data.tar.gz
		cd ..
		tar -xzOf control.tar.gz .PKGINFO | grep -q '^pkgname = hello$'
		{ tar -tzf control.tar.gz; tar -tzf data.tar.gz; } > ${tg.output}/contents
		gzip -dc data.tar.gz | grep -a -o 'APK-TOOLS\.checksum\.SHA1=' > ${tg.output}/headers
	`
		.env(build())
		.then(tg.Directory.expect);
}
