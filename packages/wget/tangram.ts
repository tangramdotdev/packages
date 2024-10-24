import * as gmp from "gmp" with { path: "../gmp" };
import * as gnutls from "gnutls" with { path: "../gnutls" };
import * as nettle from "nettle" with { path: "../nettle" };
import * as pcre2 from "pcre2" with { path: "../pcre2" };
import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };
import * as zlib from "zlib" with { path: "../zlib" };

export const metadata = {
	homepage: "https://www.gnu.org/software/wget/",
	license: "GPL-3.0-or-later",
	name: "wget",
	repository: "https://gitlab.com/gnuwget/wget2",
	version: "1.21.4",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:81542f5cefb8faacc39bbbc6c82ded80e3e4a88505ae72ea51df27525bcde04c";
	return std.download.fromGnu({ name, version, checksum });
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		gmp?: gmp.Arg;
		gnutls?: gnutls.Arg;
		nettle?: nettle.Arg;
		pcre2?: pcre2.Arg;
		zlib?: zlib.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: {
			gmp: gmpArg = {},
			gnutls: gnutlsArg = {},
			nettle: nettleArg = {},
			pcre2: pcre2Arg = {},
			zlib: zlibArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const env = [
		gmp.default_({ build, env: env_, host, sdk }, gmpArg),
		gnutls.default_({ build, env: env_, host, sdk }, gnutlsArg),
		nettle.default_({ build, env: env_, host, sdk }, nettleArg),
		pcre2.default_({ build, env: env_, host, sdk }, pcre2Arg),
		zlib.default_({ build, env: env_, host, sdk }, zlibArg),
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
		env: {
			SSL_CERT_DIR: std.caCertificates(),
		},
	});
	output = await tg.directory(output, {
		["bin/wget"]: wrappedWget,
	});
	return output;
});

export default default_;

export const test = tg.target(async () => {
	return await $`
		echo "Checking that we can run wget."
		wget --version
		echo "Checking that we can download a file."
		wget -O - https://tangram.dev > $OUTPUT
	`
		.env(default_())
		.checksum("unsafe");
});
