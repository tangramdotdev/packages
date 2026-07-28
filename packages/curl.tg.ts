import * as libpsl from "libpsl" with { source: "./libpsl.tg.ts" };
import * as openssl from "openssl" with { source: "./openssl.tg.ts" };
import * as zlib from "zlib-ng" with { source: "./zlib-ng.tg.ts" };
import * as zstd from "zstd" with { source: "./zstd.tg.ts" };
import * as std from "std" with { source: "./std" };
import { $ } from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://curl.se/",
	license: "MIT",
	name: "curl",
	repository: "https://github.com/curl/curl",
	version: "8.21.0",
	tag: "curl/8.21.0",
	provides: {
		binaries: ["curl"],
		libraries: ["curl"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:d9b327997999045a24cda50f3983e69e51c516bd8be6ef9842fc7f99135e33bb";
	const owner = name;
	const repo = name;
	const tag = `curl-${version.replace(/\./g, "_")}`;
	return std.download.fromGithub({
		owner,
		repo,
		tag,
		checksum,
		source: "release",
		version,
	});
}

export function deps() {
	return std.deps({
		libpsl: libpsl.build,
		openssl: openssl.build,
		zlib: zlib.build,
		zstd: zstd.build,
	});
}

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export function build(...args: tg.Args<Arg>) {
	return std.autotools.build(
		{
			deps,
			source: source(),
			phases: {
				configure: {
					args: [
						"--disable-dependency-tracking",
						"--disable-silent-rules",
						"--enable-optimize",
						"--with-openssl",
						tg`--with-ca-bundle=${std.caCertificates()}/ca-bundle.crt`,
					],
				},
			},
			setRuntimeLibraryPath: true,
		},
		...args,
	);
}

export default build;

export async function test() {
	const spec: std.assert.PackageSpec = {
		...std.assert.defaultSpec(metadata),
		libraries: std.assert.allLibraries(["curl"], {
			runtimeDeps: [
				openssl.build(),
				zlib.build(),
				zstd.build(),
				libpsl.build(),
			],
		}),
	};
	await std.assert.pkg(build, spec);

	const result = await $`
		set -x
		echo "Checking that we can download a file."
		mkdir -p ${tg.output}
		curl -o ${tg.output}/example http://example.com
		echo "Checking that we can download via HTTPS."
		curl -o ${tg.output}/tangram https://www.tangram.dev
	`
		.env(build())
		.checksum("sha256:any")
		.network(true)
		.then(tg.Directory.expect);

	const exampleContents = await result
		.get("example")
		.then(tg.File.expect)
		.then((f) => f.text);
	tg.assert(exampleContents.length > 0);
	tg.assert(exampleContents.startsWith("<!doctype html>"));

	const tangramContents = await result
		.get("tangram")
		.then(tg.File.expect)
		.then((f) => f.text);
	tg.assert(tangramContents.length > 0);
	tg.assert(tangramContents.startsWith("<!DOCTYPE html>"));
	return true;
}
