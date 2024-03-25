import openssl from "tg:openssl" with { path: "../openssl" };
import * as std from "tg:std" with { path: "../std" };
import zlib from "tg:zlib" with { path: "../zlib" };

export let metadata = {
	name: "libarchive",
	version: "3.6.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:9e2c1b80d5fbe59b61308fdfab6c79b5021d7ff4ff2489fb12daf0a96a83551d";
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

// FIXME - configure looks for /usr/bin/file.

export let libarchive = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = await std.triple.host(host_);
	let build = build_ ?? host;

	let configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-rpath",
			"--with-pic",
			// FIXME - provide bz2lib dylib, utils only has staticlib
			"--without-bz2lib",
			// FIXME - provide libiconv package.
			"--without-libiconv",
		],
	};

	if (!std.triple.eq(build, host)) {
		configure.args.push(`--host=${std.triple.toString(host)}`);
	}

	let phases = { configure };

	// FIXME - "-lz" should be automatic.
	let env = [openssl(arg), zlib(arg), { CFLAGS: "-lz" }, env_];

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
			echo "Checking if we can link against libarchivke."
			cc ${source}/main.c -o $OUTPUT -larchive -lz
		`,
		{ env: [std.sdk(), libarchive()] },
	);
});
