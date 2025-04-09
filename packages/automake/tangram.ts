import * as autoconf from "autoconf" with { path: "../autoconf" };
import * as bison from "bison" with { path: "../bison" };
import * as help2man from "help2man" with { path: "../help2man" };
import * as m4 from "m4" with { path: "../m4" };
import * as perl from "perl" with { path: "../perl" };
import * as pkgConfig from "pkg-config" with { path: "../pkg-config" };
import * as std from "std" with { path: "../std" };
import * as zlib from "zlib" with { path: "../zlib" };

export const metadata = {
	homepage: "https://www.gnu.org/software/automake/",
	license: "GPL-2.0-or-later",
	name: "automake",
	repository: "https://git.savannah.gnu.org/git/automake.git",
	version: "1.17",
	provides: {
		binaries: [
			"aclocal",
			"aclocal-1.17",
			"automake",
			"automake-1.17",
		],
	},
};

export const source = tg.command(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:8920c1fc411e13b90bf704ef9db6f29d540e76d232cb3b2c9f4dc4cc599bd990";
	return std.download.fromGnu({
		name,
		version,
		compression: "xz",
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
		pkgconfig?: pkgConfig.Arg;
		zlib?: zlib.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.command(async (...args: std.Args<Arg>) => {
	const {
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

	const perlArtifact = await perl.build(
		{ build, env: env_, host, sdk },
		perlArg,
	);

	const perlInterpreter = await tg.symlink({
		artifact: perlArtifact,
		subpath: "bin/perl",
	});
	const scripts = ["automake", "aclocal"];

	const { version } = metadata;
	let binDirectory = tg.directory({});
	const autoconfArtifact = autoconf.build(
		{ build, env: env_, host, sdk },
		autoconfArg,
	);
	const dependencies = [
		autoconfArtifact,
		bison.build({ build, env: env_, host, sdk }, bisonArg),
		help2man.build({ build, env: env_, host, sdk }, help2manArg),
		m4.build({ build, env: env_, host, sdk }, m4Arg),
		pkgConfig.build({ build, host: build }, pkgconfigArg),
		perlArtifact,
		zlib.build({ build, env: env_, host, sdk }, zlibArg),
	];

	const env = std.env.arg(env_, ...dependencies);

	const automake = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	for (const script of scripts) {
		const executable = tg.File.expect(
			await automake.get(`bin/${script}-${version}`),
		);
		const wrappedScript = std.wrap(executable, {
			interpreter: perlInterpreter,
			env: {
				AUTOCONF: tg.Mutation.setIfUnset(tg`${autoconfArtifact}/bin/autoconf`),
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

export const test = tg.command(async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
});
