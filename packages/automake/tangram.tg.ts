import autoconf from "tg:autoconf" with { path: "../autoconf" };
import bison from "tg:bison" with { path: "../bison" };
import help2man from "tg:help2man" with { path: "../help2man" };
import m4 from "tg:m4" with { path: "../m4" };
import perl from "tg:perl" with { path: "../perl" };
import pkgconfig from "tg:pkg-config" with { path: "../pkgconfig" };
import * as std from "tg:std" with { path: "../std" };
import zlib from "tg:zlib" with { path: "../zlib" };

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

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let automake = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let perlArtifact = await perl(arg);

	let perlInterpreter = await tg.symlink({
		artifact: perlArtifact,
		path: tg.Path.new("bin/perl"),
	});
	let scripts = ["automake", "aclocal"];

	let version = "1.16";
	let binDirectory = tg.directory({});
	let dependencies = [
		autoconf(arg),
		bison(arg),
		help2man(arg),
		m4(arg),
		pkgconfig(arg),
		perlArtifact,
		zlib(arg),
	];

	let env = [env_, std.utils.env(arg), ...dependencies];

	let automake = await std.utils.buildUtil(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
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
				PERL5LIB: tg.Mutation.templateAppend(
					tg`${automake}/share/automake-${version}`,
					":",
				),
				M4PATH: tg.Mutation.templateAppend(
					tg`${automake}/share/aclocal-${version}`,
					":",
				),
				ACLOCAL_PATH: tg.Mutation.templateAppend(
					tg`${automake}/share/aclocal-${version}`,
					":",
				),
				ACLOCAL_AUTOMAKE_DIR: tg.Mutation.templateAppend(
					tg`${automake}/share/aclocal-${version}`,
					":",
				),
				AUTOMAKE_LIBDIR: tg.Mutation.templateAppend(
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

export default automake;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: automake,
		binaries: ["automake"],
		metadata,
	});
	return true;
});
