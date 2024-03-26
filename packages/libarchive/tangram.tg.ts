import bzip2 from "tg:bzip2" with { path: "../bzip2" };
import libiconv from "tg:libiconv" with { path: "../libiconv" };
import openssl from "tg:openssl" with { path: "../openssl" };
import * as std from "tg:std" with { path: "../std" };
import xz from "tg:xz" with { path: "../xz" };
import zlib from "tg:zlib" with { path: "../zlib" };

export let metadata = {
	name: "libarchive",
	version: "3.7.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:04357661e6717b6941682cde02ad741ae4819c67a260593dfb2431861b251acb";
	let unpackFormat = ".tar.xz" as const;
	let url = `https://www.libarchive.org/downloads/${name}-${version}${unpackFormat}`;
	let download = tg.Directory.expect(
		await std.download({
			url,
			checksum,
			unpackFormat,
		}),
	);
	return std.directory.unwrap(download);
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let libarchive = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let configure = {
		args: ["--disable-dependency-tracking", "--disable-rpath", "--with-pic"],
	};

	if (build !== host) {
		configure.args.push(`--host=${host}`);
	}

	let phases = { configure };

	let env = [bzip2(arg), libiconv(arg), openssl(arg), xz(arg), zlib(arg), env_];

	return std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			source: source_ ?? source(),
			phases,
		},
		autotools,
	);
});

export default libarchive;

export let test = tg.target(async () => {
	let source = tg.directory({
		["main.c"]: tg.file(`
			#include <stdio.h>
			int main () {}
		`),
	});

	return std.build(
		tg`
			echo "Checking if we can link against libarchive."
			cc ${source}/main.c -o $OUTPUT -lssl -lcrypto -larchive -lz -lbz2 -liconv -llzma
		`,
		{
			env: [
				std.sdk(),
				bzip2(),
				libiconv(),
				openssl(),
				libarchive(),
				xz(),
				zlib(),
			],
		},
	);
});
