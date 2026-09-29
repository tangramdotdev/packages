import * as autoconf from "autoconf" with { source: "./autoconf.tg.ts" };
import * as help2man from "help2man" with { source: "./help2man.tg.ts" };
import * as perl from "perl" with { source: "./perl" };
import * as std from "std" with { source: "./std" };
import * as zlib from "zlib-ng" with { source: "./zlib-ng.tg.ts" };

export function deps() {
	return std.deps({
		autoconf: { build: autoconf.build, kind: "full" },
		help2man: { build: help2man.build, kind: "buildtime" },
		perl: { build: perl.build, kind: "full" },
		zlib: zlib.build,
	});
}

export const metadata = {
	homepage: "https://www.gnu.org/software/automake/",
	license: "GPL-2.0-or-later",
	name: "automake",
	repository: "https://git.savannah.gnu.org/git/automake.git",
	version: "1.19",
	tag: "automake/1.19",
	provides: {
		binaries: ["aclocal", "aclocal-1.19", "automake", "automake-1.19"],
	},
};

// Automake uses its API version (major.minor) for the executable and share-directory names.
const apiVersion = "1.19";

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:e3e2c2e3abf37898138db5b6c1d1dc35c9160c5978be7947d2c741705251d445";
	return std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});
}

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export async function build(...args: tg.Args<Arg>) {
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

	// Use the API version (major.minor) for binary and share-directory names.
	const version = apiVersion;
	let binDirectory = tg.directory({});

	const automake = await std.autotools.build(arg);

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
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
