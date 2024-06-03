import * as bzip2 from "tg:bzip2" with { path: "../bzip2" };
import * as libiconv from "tg:libiconv" with { path: "../libiconv" };
import * as openssl from "tg:openssl" with { path: "../openssl" };
import * as std from "tg:std" with { path: "../std" };
import * as xz from "tg:xz" with { path: "../xz" };
import * as zlib from "tg:zlib" with { path: "../zlib" };

export let metadata = {
	name: "libarchive",
	version: "3.7.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:04357661e6717b6941682cde02ad741ae4819c67a260593dfb2431861b251acb";
	let extension = ".tar.xz";
	let packageArchive = std.download.packageArchive({
		name,
		version,
		extension,
	});
	let url = `https://www.libarchive.org/downloads/${packageArchive}`;
	let download = tg.Directory.expect(await std.download({ url, checksum }));
	return std.directory.unwrap(download);
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		bzip2: bzip2.Arg;
		libiconv: libiconv.Arg;
		openssl: openssl.Arg;
		xz: xz.Arg;
		zlib: zlib.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build: build_,
		dependencies: {
			bzip2: bzip2Arg = {},
			libiconv: libiconvArg = {},
			openssl: opensslArg = {},
			xz: xzArg = {},
			zlib: zlibArg = {},
		} = {},
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let configure = {
		args: ["--disable-dependency-tracking", "--disable-rpath", "--with-pic"],
	};

	if (build !== host) {
		configure.args.push(`--host=${host}`);
	}

	let phases = { configure };

	let env = std.env.arg(
		bzip2.build(bzip2Arg),
		libiconv.build(libiconvArg),
		openssl.build(opensslArg),
		xz.build(xzArg),
		zlib.build(zlibArg),
		env_,
	);

	return std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			env,
			phases,
			source: source_ ?? source(),
			sdk,
		},
		autotools,
	);
});

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
			env: std.env.arg(
				std.sdk(),
				bzip2.build(),
				libiconv.build(),
				openssl.build(),
				libarchive(),
				xz.xz(),
				zlib.build(),
			),
		},
	);
});
