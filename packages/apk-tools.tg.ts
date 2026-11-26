import * as abuild from "abuild" with { source: "./abuild.tg.ts" };
import * as meson from "meson" with { source: "./meson.tg.ts" };
import * as openssl from "openssl" with { source: "./openssl.tg.ts" };
import * as std from "std" with { source: "./std" };
import { $ } from "std" with { source: "./std" };
import * as zlib from "zlib-ng" with { source: "./zlib-ng.tg.ts" };
import * as zstd from "zstd" with { source: "./zstd.tg.ts" };

export const metadata = {
	builds: {
		exports: ["default", "build"],
		hosts: ["aarch64-linux", "x86_64-linux"],
	},
	homepage: "https://gitlab.alpinelinux.org/alpine/apk-tools",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-2.0-only",
	name: "apk-tools",
	repository: "https://gitlab.alpinelinux.org/alpine/apk-tools",
	version: "3.0.11",
	tag: "apk-tools/3.0.11",
	provides: {
		binaries: ["apk"],
		libraries: [{ name: "apk", pkgConfigName: "apk", staticlib: false }],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:6098fed5888a392bf5337a728a78ce1707a28cf9ec2650f078e29f21e9bc926f";
	return std
		.download({
			url: `https://gitlab.alpinelinux.org/alpine/${name}/-/archive/v${version}/${name}-v${version}.tar.gz`,
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
		zstd: zstd.build,
	});
}

export type Arg = meson.BuildArg & std.deps.Arg<typeof deps>;

export async function build(...args: tg.Args<Arg>) {
	// Leave out the manual pages and the built-in help, which need scdoc and Lua, and the Lua and Python bindings.
	const resolved = await meson.arg(
		{
			deps,
			source: source(),
			phases: {
				configure: {
					args: [
						"-Ddocs=disabled",
						"-Dhelp=disabled",
						"-Dlua=disabled",
						"-Dpython=disabled",
						"-Dtests=disabled",
						"-Dzstd=enabled",
					],
				},
			},
		},
		...args,
	);
	std.assert.supportedHost(resolved.host, metadata);
	return await meson.build(resolved);
}

export default build;

export async function test() {
	const runtimeDeps = [openssl.build(), zlib.build(), zstd.build()];
	const spec: std.assert.PackageSpec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.binaries(metadata.provides.binaries, {
			apk: { snapshot: `apk-tools ${metadata.version}` },
		}),
		libraries: metadata.provides.libraries.map((library) => ({
			...library,
			runtimeDeps,
		})),
	};
	await std.assert.pkg(build, spec);

	// Check a version as the Tangram release does, index a directory that contains an unsigned package, and read the package back from the index and from the package.
	const packages = await abuild.testPackage();
	const output = await $`
		set -eu
		apk version --check 1.0.0_rc1-r0
		if apk version --check 1.0.0-rc1-r0; then
			echo "an invalid version passed the check" >&2
			exit 1
		fi
		mkdir -p repo/x86_64
		cp ${packages}/hello-1.0.0-r0.apk repo/x86_64/
		cd repo/x86_64
		apk_repo() {
			apk --allow-untrusted --repositories-file /dev/null --keys-dir "$PWD" --arch x86_64 "$@"
		}
		apk_repo index --no-warnings --output APKINDEX.tar.gz ./*.apk
		mkdir -p ${tg.output}
		tar -xzOf APKINDEX.tar.gz APKINDEX > ${tg.output}/APKINDEX
		mkdir ${tg.output}/extracted
		apk_repo extract --destination ${tg.output}/extracted hello-1.0.0-r0.apk
	`
		.env(build())
		.then(tg.Directory.expect);
	const index = await output
		.get("APKINDEX")
		.then(tg.File.expect)
		.then((file) => file.text);
	tg.assert(index.includes("\nP:hello\n"), `unexpected index: ${index}`);
	tg.assert(index.includes("\nV:1.0.0-r0\n"), `unexpected index: ${index}`);
	tg.assert(index.includes("\nA:x86_64\n"), `unexpected index: ${index}`);
	const hello = await output
		.get("extracted/usr/bin/hello")
		.then(tg.File.expect)
		.then((file) => file.text);
	tg.assert(hello === "#!/bin/sh\necho hello\n");
	return true;
}
