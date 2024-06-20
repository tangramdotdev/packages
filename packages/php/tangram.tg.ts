import * as libffi from "tg:libffi" with { path: "../libffi" };
import * as ncurses from "tg:ncurses" with { path: "../ncurses" };
import * as pkgconfig from "tg:pkgconfig" with { path: "../pkgconfig" };
import * as openssl from "tg:openssl" with { path: "../openssl" };
import * as readline from "tg:readline" with { path: "../readline" };
import * as sqlite from "tg:sqlite" with { path: "../sqlite" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://www.php.net",
	license: "https://www.php.net/license",
	name: "php",
	repository: "https://github.com/php/php-src",
	version: "8.3.8",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	// Taken from https://www.php.net/downloads.php
	let checksum =
		"sha256:aea358b56186f943c2bbd350c9005b9359133d47e954cfc561385319ae5bb8d7";
	let extension = "tar.xz";
	let url = `https://www.php.net/distributions/${name}-${version}.${extension}`;
	return std
		.download({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	build?: string;
	dependencies?: {
		libffi?: libffi.Arg;
		ncurses?: ncurses.Arg;
		pkgconfig?: pkgconfig.Arg;
		openssl?: openssl.Arg;
		readline?: readline.Arg;
		sqlite?: sqlite.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		build: build_,
		dependencies: {
			libffi: libffiArg = {},
			ncurses: ncursesArg = {},
			pkgconfig: pkgconfigArg = {},
			openssl: opensslArg = {},
			readline: readlineArg = {},
			sqlite: sqliteArg = {},
		} = {},
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let dependencies = [
		libffi.build(libffiArg),
		ncurses.build(ncursesArg),
		pkgconfig.build(pkgconfigArg),
		openssl.build(opensslArg),
		readline.build(readlineArg),
		sqlite.build(sqliteArg),
	];
	let env = std.env.arg(...dependencies, env_);

	let sourceDir = source_ ?? source();

	let configure = {
		args: ["--with-ffi", "--with-openssl", "--without-libxml"],
	};
	let phases = { configure };

	return std.autotools.build({
		...std.triple.rotate({ build, host }),
		debug: true,
		env,
		phases,
		sdk,
		source: sourceDir,
	});
});

export default build;
