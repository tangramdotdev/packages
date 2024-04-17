import gmp from "tg:gmp" with { path: "../gmp" };
import nettle from "tg:nettle" with { path: "../nettle" };
import * as std from "tg:std" with { path: "../std" };
import zlib from "tg:zlib" with { path: "../zlib" };

export let metadata = {
	name: "gnutls",
	version: "3.7.10",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:b6e4e8bac3a950a3a1b7bdb0904979d4ab420a81e74de8636dd50b467d36f5a9";
	let extension = ".tar.xz";
	let packageArchive = std.download.packageArchive({
		extension,
		name,
		version,
	});
	let url = `https://www.gnupg.org/ftp/gcrypt/${name}/v3.7/${packageArchive}`;
	let download = tg.Directory.expect(await std.download({ checksum, url }));
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

export let gnutls = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let env = [gmp(arg), nettle(arg), zlib(arg), env_];

	let configure = {
		args: [
			"--disable-doc",
			"--with-included-libtasn1",
			"--with-included-unistring",
			"--without-p11-kit",
		],
	};

	let phases = { configure };

	return std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default gnutls;

export let test = tg.target(() => {
	let source = tg.directory({
		["main.c"]: tg.file(`
			#include <stdio.h>
			int main () {}
		`),
	});

	return std.build(
		tg`
			echo "Checking if we can link against gnutls."
			cc ${source}/main.c -o $OUTPUT -lnettle -lhogweed -lgmp -lgnutls -lz
		`,
		{ env: [std.sdk(), gnutls(), nettle(), gmp(), zlib()] },
	);
});
