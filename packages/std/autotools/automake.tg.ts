import * as std from "../tangram.ts";

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

export type Arg = {
	build?: string | null;
	env?: std.env.Arg | null;
	host?: string | null;
	autoconfArtifact: tg.Directory;
	perlArtifact: tg.Directory;
	sdk?: std.sdk.Arg | null;
	source?: tg.Directory | null;
};

export async function build(arg: tg.Unresolved<Arg>) {
	const {
		build,
		env: env_,
		host,
		autoconfArtifact,
		perlArtifact,
		sdk,
		source: source_,
	} = await tg.resolve(arg);

	const perlInterpreter = await tg.symlink({
		artifact: perlArtifact,
		path: "bin/perl",
	});
	const scripts = ["automake", "aclocal"];

	// Use the API version (major.minor) for binary and share-directory names.
	const version = apiVersion;
	let binDirectory = tg.directory({});

	const env = std.env.compose(env_ ?? null);

	const automake = await std.utils.autotoolsInternal({
		build: build ?? null,
		host: host ?? null,
		env,
		processName: metadata.name,
		...std.args.optional("sdk", sdk),
		source: source_ ?? source(),
	});

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
			buildToolchain: env,
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
