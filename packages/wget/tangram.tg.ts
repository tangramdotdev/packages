import * as gmp from "tg:gmp" with { path: "../gmp" };
import * as gnutls from "tg:gnutls" with { path: "../gnutls" };
import * as nettle from "tg:nettle" with { path: "../nettle" };
import * as pcre2 from "tg:pcre2" with { path: "../pcre2" };
import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };
import * as zlib from "tg:zlib" with { path: "../zlib" };

export let metadata = {
	name: "wget",
	version: "1.21.4",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:81542f5cefb8faacc39bbbc6c82ded80e3e4a88505ae72ea51df27525bcde04c";
	return std.download.fromGnu({ name, version, checksum });
});

type Arg = {
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

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
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

	let env = [
		gmp.build(gmpArg),
		gnutls.build(gnutlsArg),
		nettle.build(nettleArg),
		pcre2.build(pcre2Arg),
		zlib.build(zlibArg),
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
			...std.triple.rotate({ build, host }),
			env: std.env.arg(env),
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	// Wrap the binary to include the CA certificates.
	let wgetFile = tg.File.expect(await output.get("bin/wget"));
	let wrappedWget = std.wrap(wgetFile, {
		env: {
			SSL_CERT_DIR: std.caCertificates(),
		},
	});
	output = await tg.directory(output, {
		["bin/wget"]: wrappedWget,
	});
	return output;
});

export default build;

export let test = tg.target(async () => {
	return await $`
		echo "Checking that we can run wget."
		wget --version
		echo "Checking that we can download a file."
		wget -O - https://tangram.dev > $OUTPUT
	`
		.env(wget())
		.checksum("unsafe");
});
