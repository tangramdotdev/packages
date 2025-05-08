import * as std from "../tangram.ts";

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
	build?: string;
	env?: std.env.Arg;
	host?: string;
	autoconfArtifact: tg.Directory;
	perlArtifact: tg.Directory;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export const build = async (arg: tg.Unresolved<Arg>) => {
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
		subpath: "bin/perl",
	});
	const scripts = ["automake", "aclocal"];

	const { version } = metadata;
	let binDirectory = tg.directory({});

	const env = std.env.arg(env_);

	const automake = await std.utils.autotoolsInternal({
		...(await std.triple.rotate({ build, host })),
		env,
		sdk,
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
};

export default build;
