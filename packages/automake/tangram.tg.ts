import * as autoconf from "tg:autoconf" with { path: "../autoconf" };
import * as bison from "tg:bison" with { path: "../bison" };
import * as help2man from "tg:help2man" with { path: "../help2man" };
import * as m4 from "tg:m4" with { path: "../m4" };
import * as perl from "tg:perl" with { path: "../perl" };
import * as pkgconfig from "tg:pkg-config" with { path: "../pkgconfig" };
import * as std from "tg:std" with { path: "../std" };
import * as zlib from "tg:zlib" with { path: "../zlib" };

export let metadata = {
	homepage: "https://www.gnu.org/software/automake/",
	license: "GPL-2.0-or-later",
	name: "automake",
	repository: "https://git.savannah.gnu.org/git/automake.git",
	version: "1.16.5",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:f01d58cd6d9d77fbdca9eb4bbd5ead1988228fdb73d6f7a201f5f8d6b118b469";
	return std.download.fromGnu({
		name,
		version,
		compressionFormat: "xz",
		checksum,
	});
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		autoconf?: autoconf.Arg;
		bison?: bison.Arg;
		help2man?: help2man.Arg;
		m4?: m4.Arg;
		perl?: perl.Arg;
		pkgconfig?: pkgconfig.Arg;
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
			autoconf: autoconfArg = {},
			bison: bisonArg = {},
			help2man: help2manArg = {},
			m4: m4Arg = {},
			perl: perlArg = {},
			pkgconfig: pkgconfigArg = {},
			zlib: zlibArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let perlArtifact = await perl.build(perlArg);

	let perlInterpreter = await tg.symlink({
		artifact: perlArtifact,
		path: tg.Path.new("bin/perl"),
	});
	let scripts = ["automake", "aclocal"];

	let version = "1.16";
	let binDirectory = tg.directory({});
	let dependencies = [
		autoconf.build(autoconfArg),
		bison.build(bisonArg),
		help2man.build(help2manArg),
		m4.build(m4Arg),
		pkgconfig.build(pkgconfigArg),
		perlArtifact,
		zlib.build(zlibArg),
	];

	let env = std.env.arg(env_, ...dependencies);

	let automake = await std.utils.buildUtil(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	for (let script of scripts) {
		let executable = tg.File.expect(
			await automake.get(`bin/${script}-${version}`),
		);
		let wrappedScript = std.wrap(executable, {
			interpreter: perlInterpreter,
			env: {
				PERL5LIB: tg.Mutation.suffix(
					tg`${automake}/share/automake-${version}`,
					":",
				),
				M4PATH: tg.Mutation.suffix(
					tg`${automake}/share/aclocal-${version}`,
					":",
				),
				ACLOCAL_PATH: tg.Mutation.suffix(
					tg`${automake}/share/aclocal-${version}`,
					":",
				),
				ACLOCAL_AUTOMAKE_DIR: tg.Mutation.suffix(
					tg`${automake}/share/aclocal-${version}`,
					":",
				),
				AUTOMAKE_LIBDIR: tg.Mutation.suffix(
					tg`${automake}/share/automake-${version}`,
					":",
				),
				AUTOMAKE_UNINSTALLED: "true",
			},
		});

		binDirectory = tg.directory(binDirectory, {
			[`${script}-${version}`]: wrappedScript,
		});
	}

	binDirectory = tg.directory(binDirectory, {
		["automake"]: tg.symlink(`automake-${version}`),
		["aclocal"]: tg.symlink(`aclocal-${version}`),
	});

	return tg.directory({
		["bin"]: binDirectory,
	});
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["automake"],
		metadata,
	});
	return true;
});
