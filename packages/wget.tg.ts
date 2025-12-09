import * as gmp from "gmp" with { local: "./gmp" };
import * as gnutls from "gnutls" with { local: "./gnutls.tg.ts" };
import * as libpsl from "libpsl" with { local: "./libpsl.tg.ts" };
import * as libiconv from "libiconv" with { local: "./libiconv.tg.ts" };
import * as nettle from "nettle" with { local: "./nettle.tg.ts" };
import * as pcre2 from "pcre2" with { local: "./pcre2.tg.ts" };
import * as std from "std" with { local: "./std" };
import { $ } from "std" with { local: "./std" };
import * as zlib from "zlib" with { local: "./zlib.tg.ts" };
import * as zstd from "zstd" with { local: "./zstd.tg.ts" };

export const metadata = {
	homepage: "https://www.gnu.org/software/wget/",
	license: "GPL-3.0-or-later",
	name: "wget",
	repository: "https://www.gnu.org/software/wget/",
	version: "1.25.0",
	tag: "wget/1.25.0",
	provides: {
		binaries: ["wget"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:766e48423e79359ea31e41db9e5c289675947a7fcf2efdcedb726ac9d0da3784";
	return std.download.fromGnu({ name, version, checksum });
};

const deps = await std.deps({
	gmp: gmp.build,
	gnutls: gnutls.build,
	libiconv: libiconv.build,
	libpsl: libpsl.build,
	nettle: nettle.build,
	pcre2: pcre2.build,
	zlib: zlib.build,
	zstd: zstd.build,
});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{
			source: source(),
			deps,
			env: {
				CFLAGS: tg.Mutation.suffix("-Wno-implicit-function-declaration", " "),
			},
		},
		...args,
	);

	const setRuntimeLibraryPath =
		std.triple.os(arg.host) === "linux" ? true : arg.setRuntimeLibraryPath;

	const output = await std.autotools.build({
		...arg,
		setRuntimeLibraryPath,
	});

	// Wrap the binary to include the CA certificates.
	const wgetFile = tg.File.expect(await output.get("bin/wget"));
	const wrappedWget = std.wrap(wgetFile, {
		args: [tg`--ca-certificate=${std.caCertificates()}/cacert.pem`],
	});
	return tg.directory(output, {
		["bin/wget"]: wrappedWget,
	});
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	await std.assert.pkg(build, spec);

	const result = await $`
		echo "Checking that we can download a file."
		mkdir -p ${tg.output}
		wget -O ${tg.output}/example http://example.com
		echo "Checking that we can download via HTTPS."
		wget -O ${tg.output}/tangram https://www.tangram.dev
	`
		.env(build())
		.checksum("sha256:any")
		.network(true)
		.then(tg.Directory.expect);

	const exampleContents = await result
		.get("example")
		.then(tg.File.expect)
		.then((f) => f.text());
	tg.assert(exampleContents.length > 0);
	tg.assert(exampleContents.startsWith("<!doctype html>"));

	const tangramContents = await result
		.get("tangram")
		.then(tg.File.expect)
		.then((f) => f.text());
	tg.assert(tangramContents.length > 0);
	tg.assert(tangramContents.startsWith("<!DOCTYPE html>"));
	return true;
};
