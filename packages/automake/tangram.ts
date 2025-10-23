import * as autoconf from "autoconf" with { local: "../autoconf" };
import * as help2man from "help2man" with { local: "../help2man" };
import * as perl from "perl" with { local: "../perl" };
import * as std from "std" with { local: "../std" };
import * as zlib from "zlib" with { local: "../zlib" };

export const metadata = {
	homepage: "https://www.gnu.org/software/automake/",
	license: "GPL-2.0-or-later",
	name: "automake",
	repository: "https://git.savannah.gnu.org/git/automake.git",
	version: "1.18",
	tag: "automake/1.18",
	provides: {
		binaries: ["aclocal", "aclocal-1.18", "automake", "automake-1.18"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:5bdccca96b007a7e344c24204b9b9ac12ecd17f5971931a9063bdee4887f4aaf";
	return std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		autoconf?: autoconf.Arg;
		help2man?: help2man.Arg;
		perl?: perl.Arg;
		zlib?: zlib.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: {
			autoconf: autoconfArg = {},
			help2man: help2manArg = {},
			perl: perlArg = {},
			zlib: zlibArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const perlArtifact = await perl.build(
		{ build, env: env_, host, sdk },
		perlArg,
	);

	const perlInterpreter = await tg.symlink({
		artifact: perlArtifact,
		path: "bin/perl",
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
		help2man.build({ build, env: env_, host, sdk }, help2manArg),
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
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
