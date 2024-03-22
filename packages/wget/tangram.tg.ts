import gmp from "tg:gmp" with { path: "../gmp" };
import gnutls from "tg:gnutls" with { path: "../gnutls" };
import nettle from "tg:nettle" with { path: "../nettle" };
import pcre2 from "tg:pcre2" with { path: "../pcre2" };
import * as std from "tg:std" with { path: "../std" };
import zlib from "tg:zlib" with { path: "../zlib" };

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
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let wget = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let env = [
		gmp(arg),
		gnutls(arg),
		nettle(arg),
		pcre2(arg),
		zlib(arg),
		{
			LDFLAGS: tg.Mutation.templateAppend(
				"-lnettle -lhogweed -lpcre2-8 -lgmp -lgnutls -lz",
				" ",
			),
		},
		env_,
	];

	let output = await std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
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

	export let test = tg.target(async () => {
		return std.build(
			tg`
		echo "Checking that we can run wget."
		wget --version
		echo "Checking that we can download a file."
		wget -O - https://tangram.dev > $OUTPUT
	`,
			{ env: wget(), checksum: "unsafe" },
		);
	});
