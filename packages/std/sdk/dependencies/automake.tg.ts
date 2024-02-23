import * as std from "../../tangram.tg.ts";
import autoconf from "./autoconf.tg.ts";
import bison from "./bison.tg.ts";
import help2man from "./help2man.tg.ts";
import m4 from "./m4.tg.ts";
import make from "./make.tg.ts";
import perl from "./perl.tg.ts";
import pkgconfig from "./pkg_config.tg.ts";
import zlib from "./zlib.tg.ts";

export let metadata = {
	name: "automake",
	version: "1.16.5",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:f01d58cd6d9d77fbdca9eb4bbd5ead1988228fdb73d6f7a201f5f8d6b118b469";
	return std.download.fromGnu({ name, version, compressionFormat, checksum });
});

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
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
		path: "bin/perl",
	});
	let scripts = ["automake", "aclocal"];

	let version = "1.16";
	let binDirectory = tg.directory({});
	let dependencies = [
		autoconf(arg),
		bison(arg),
		help2man(arg),
		m4(arg),
		make(arg),
		pkgconfig(arg),
		perlArtifact,
		zlib(arg),
	];

	let env = [env_, std.utils.env(arg), ...dependencies];

	let automake = await std.utils.buildUtil(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
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
			sdk: arg?.sdk,
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

import * as bootstrap from "../../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = bootstrap.toolchainTriple(await tg.Triple.host());
	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });
	let directory = build({ host, bootstrapMode, env: sdk });
	await std.assert.pkg({
		directory,
		binaries: ["automake"],
		metadata,
	});
	return directory;
});
