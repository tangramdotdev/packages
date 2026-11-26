import * as bzip2 from "bzip2" with { source: "./bzip2" };
import * as libmd from "libmd" with { source: "./libmd.tg.ts" };
import * as perl from "perl" with { source: "./perl" };
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
	homepage: "https://wiki.debian.org/Teams/Dpkg",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-2.0-or-later",
	name: "dpkg",
	repository: "https://git.dpkg.org/git/dpkg/dpkg.git",
	version: "1.23.12",
	tag: "dpkg/1.23.12",
	provides: {
		binaries: [
			"dpkg",
			"dpkg-deb",
			"dpkg-divert",
			"dpkg-query",
			"dpkg-realpath",
			"dpkg-split",
			"dpkg-statoverride",
			"dpkg-trigger",
		],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:829e7a454f61232b33372c1564b803ab16cfc98e08bd2ec1e2b94bdb1fb97502";
	return std
		.download({
			url: `https://deb.debian.org/debian/pool/main/d/${name}/${name}_${version}.tar.xz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export function deps() {
	return std.deps({
		bzip2: bzip2.build,
		libmd: libmd.build,
		perl: { build: perl.build, kind: "buildtime" },
		xz: xz.build,
		zlib: zlib.build,
		zstd: zstd.build,
	});
}

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export async function build(...args: tg.Args<Arg>) {
	// Build and install only the C programs, which include `dpkg-deb`, and the architecture tables in `share/dpkg`. The Perl scripts and modules, dselect, start-stop-daemon, update-alternatives, the manual pages, and the translations are left out. The programs run `tar` from the `PATH`, which must be GNU tar.
	const sourceDir = await source();
	const arg = await std.autotools.arg(
		{
			deps,
			source: sourceDir,
			phases: {
				configure: {
					args: [
						"--disable-devel-docs",
						"--disable-dselect",
						"--disable-nls",
						"--disable-start-stop-daemon",
						"--disable-update-alternatives",
						"--with-libbz2",
						"--with-liblzma",
						"--with-libz",
						"--with-libzstd",
						"--without-libselinux",
						"TAR=tar",
					],
				},
				build: `make -C lib -j"$(nproc)" && make -C src -j"$(nproc)"`,
				install: tg`
					make -C src install
					mkdir -p ${tg.output}/share/dpkg
					cp ${sourceDir}/data/abitable ${sourceDir}/data/cputable ${sourceDir}/data/ostable ${sourceDir}/data/tupletable ${tg.output}/share/dpkg
				`,
			},
		},
		...args,
	);
	std.assert.supportedHost(arg.host, metadata);
	return std.autotools.build(arg);
}

export default build;

export async function test() {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.allBinaries(metadata.provides.binaries, {
			snapshot: metadata.version,
		}),
	};
	await std.assert.pkg(build, spec);

	const output = await testPackage();
	const fields = await output
		.get("fields")
		.then(tg.File.expect)
		.then((file) => file.text);
	tg.assert(
		fields === "Package: hello\nVersion: 1.0.0\nArchitecture: amd64\n",
		`unexpected fields: ${fields}`,
	);
	const contents = await output
		.get("contents")
		.then(tg.File.expect)
		.then((file) => file.text);
	tg.assert(
		/^-rwxr-xr-x root\/root .* \.\/usr\/bin\/hello$/m.test(contents),
		`unexpected contents: ${contents}`,
	);
	const info = await output
		.get("info")
		.then(tg.File.expect)
		.then((file) => file.text);
	tg.assert(info.includes(" Package: hello"), `unexpected info: ${info}`);
	const hello = await output
		.get("hello")
		.then(tg.File.expect)
		.then((file) => file.text);
	tg.assert(hello === "#!/bin/sh\necho hello\n");
	return true;
}

/** Build a tiny package with `dpkg-deb`, as the Tangram release does, and read its control fields and contents back. The output contains the package at `hello_1.0.0_amd64.deb`. */
export async function testPackage() {
	return await $`
		set -eu
		mkdir -p package/DEBIAN package/usr/bin
		printf '#!/bin/sh\necho hello\n' > package/usr/bin/hello
		chmod 755 package/usr/bin/hello
		printf 'Package: hello\nVersion: 1.0.0\nArchitecture: amd64\nMaintainer: Tangram <support@tangram.dev>\nDescription: A test package.\n' > package/DEBIAN/control
		mkdir -p ${tg.output}
		deb=${tg.output}/hello_1.0.0_amd64.deb
		dpkg-deb --root-owner-group -Zgzip --build package "$deb"
		dpkg-deb --field "$deb" Package Version Architecture > ${tg.output}/fields
		dpkg-deb --contents "$deb" > ${tg.output}/contents
		dpkg-deb --info "$deb" > ${tg.output}/info
		dpkg-deb --extract "$deb" extracted
		cp extracted/usr/bin/hello ${tg.output}/hello
	`
		.env(build())
		.then(tg.Directory.expect);
}
