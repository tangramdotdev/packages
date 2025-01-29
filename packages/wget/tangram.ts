import gettext from "gettext" with { path: "../gettext" };
import * as gmp from "gmp" with { path: "../gmp" };
import * as gnutls from "gnutls" with { path: "../gnutls" };
import * as libpsl from "libpsl" with { path: "../libpsl" };
import * as libiconv from "libiconv" with { path: "../libiconv" };
import * as nettle from "nettle" with { path: "../nettle" };
import * as pcre2 from "pcre2" with { path: "../pcre2" };
import pkgConfig from "pkgconf" with { path: "../pkgconf" };
import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };
import * as zlib from "zlib" with { path: "../zlib" };
import * as zstd from "zstd" with { path: "../zstd" };

export const metadata = {
	homepage: "https://www.gnu.org/software/wget/",
	license: "GPL-3.0-or-later",
	name: "wget",
	repository: "https://gitlab.com/gnuwget/wget2",
	version: "1.24.5",
	provides: {
		binaries: ["wget"],
	},
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:fa2dc35bab5184ecbc46a9ef83def2aaaa3f4c9f3c97d4bd19dcb07d4da637de";
	return std.download.fromGnu({ name, version, checksum });
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		gmp?: gmp.Arg;
		gnutls?: gnutls.Arg;
		libiconv?: libiconv.Arg;
		libpsl?: libpsl.Arg;
		nettle?: nettle.Arg;
		pcre2?: pcre2.Arg;
		zlib?: zlib.Arg;
		zstd?: zstd.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: {
			gmp: gmpArg = {},
			gnutls: gnutlsArg = {},
			libiconv: libiconvArg = {},
			libpsl: libpslArg = {},
			nettle: nettleArg = {},
			pcre2: pcre2Arg = {},
			zlib: zlibArg = {},
			zstd: zstdArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const env = [
		gettext({ build, host: build }),
		gmp.build({ build, env: env_, host, sdk }, gmpArg),
		gnutls.build({ build, env: env_, host, sdk }, gnutlsArg),
		nettle.build({ build, env: env_, host, sdk }, nettleArg),
		libiconv.build({ build, env: env_, host, sdk }, libiconvArg),
		libpsl.build({ build, env: env_, host, sdk }, libpslArg),
		pcre2.build({ build, env: env_, host, sdk }, pcre2Arg),
		pkgConfig({ build, host: build }),
		zlib.build({ build, env: env_, host, sdk }, zlibArg),
		zstd.build({ build, env: env_, host, sdk }, zstdArg),
		{
			LDFLAGS: tg.Mutation.suffix(
				"-lnettle -lhogweed -lpcre2-8 -lgmp -lgnutls -lz",
				" ",
			),
		},
		env_,
	];

	let output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(env),
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	// Wrap the binary to include the CA certificates.
	const wgetFile = tg.File.expect(await output.get("bin/wget"));
	const wrappedWget = std.wrap(wgetFile, {
		args: [tg`--ca-certificate=${std.caCertificates()}/cacert.pem`],
	});
	output = await tg.directory(output, {
		["bin/wget"]: wrappedWget,
	});
	return output;
});

export default build;
export const test = tg.target(async () => {
	const spec = std.assert.defaultSpec(metadata);
	await std.assert.pkg(build, spec);

	const result = await $`
		echo "Checking that we can download a file."
		mkdir -p $OUTPUT
		wget -O $OUTPUT/example http://example.com
		echo "Checking that we can download via HTTPS."
		wget -O $OUTPUT/tangram https://www.tangram.dev
	`
		.env(build())
		.checksum("unsafe")
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
});
