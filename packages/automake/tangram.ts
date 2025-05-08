import * as autoconf from "autoconf" with { path: "../autoconf" };
import * as help2man from "help2man" with { path: "../help2man" };
import * as perl from "perl" with { path: "../perl" };
import * as std from "std" with { path: "../std" };
import * as zlib from "zlib" with { path: "../zlib" };

export const metadata = {
	homepage: "https://www.gnu.org/software/automake/",
	license: "GPL-2.0-or-later",
	name: "automake",
	repository: "https://git.savannah.gnu.org/git/automake.git",
	version: "1.17",
	provides: {
		binaries: ["aclocal", "aclocal-1.17", "automake", "automake-1.17"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:8920c1fc411e13b90bf704ef9db6f29d540e76d232cb3b2c9f4dc4cc599bd990";
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

export const build = async (...args: tg.Args<Arg>) => {
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
