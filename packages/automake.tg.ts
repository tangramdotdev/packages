import * as autoconf from "autoconf" with { local: "./autoconf.tg.ts" };
import * as help2man from "help2man" with { local: "./help2man.tg.ts" };
import * as perl from "perl" with { local: "./perl" };
import * as std from "std" with { local: "./std" };
import * as zlib from "zlib" with { local: "./zlib.tg.ts" };

const deps = std.deps({
	autoconf: autoconf.build,
	help2man: { build: help2man.build, kind: "buildtime" },
	perl: perl.build,
	zlib: zlib.build,
});

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

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{
			source: source(),
			deps,
		},
		...args,
	);

	const { autoconf: autoconfArtifact, perl: perlArtifact } =
		await std.deps.artifacts(deps, { build: arg.build, host: arg.host });
	tg.assert(perlArtifact !== undefined);
	tg.assert(autoconfArtifact !== undefined);

	const perlInterpreter = await tg.symlink({
		artifact: perlArtifact,
		path: "bin/perl",
	});
	const scripts = ["automake", "aclocal"];

	const { version } = metadata;
	let binDirectory = tg.directory({});

	const automake = await std.autotools.build(arg);

	for (const script of scripts) {
		const executable = tg.File.expect(
			await automake.get(`bin/${script}-${version}`),
		);
		const wrappedScript = std.wrap(executable, {
			interpreter: perlInterpreter,
			env: {
				AUTOCONF: tg.Mutation.setIfUnset<tg.Template.Arg>(
					tg`${autoconfArtifact}/bin/autoconf`,
				),
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
