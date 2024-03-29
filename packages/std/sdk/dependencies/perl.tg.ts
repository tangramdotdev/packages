import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.tg.ts";
import bison from "./bison.tg.ts";
import libffi from "./libffi.tg.ts";
import m4 from "./m4.tg.ts";
import zlib from "./zlib.tg.ts";

export let metadata = {
	name: "perl",
	version: "5.38.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;

	// Download raw source.
	let unpackFormat = ".tar.gz" as const;
	let packageArchive = std.download.packageArchive({
		name,
		version,
		unpackFormat,
	});
	let checksum =
		"sha256:a0a31534451eb7b83c7d6594a497543a54d488bc90ca00f5e34762577f40655e";
	let url = `https://www.cpan.org/src/5.0/${packageArchive}`;
	let source = tg.Directory.expect(
		await std.download({ url, checksum, unpackFormat }),
	);
	source = await std.directory.unwrap(source);

	// Apply patches.
	let patches = [];

	let macosPatch = tg.File.expect(
		await tg.include("./perl_macos_version.patch"),
	);
	patches.push(macosPatch);

	let noFixDepsPatch = tg.File.expect(
		await tg.include("./perl_no_fix_deps.patch"),
	);
	patches.push(noFixDepsPatch);

	let cppPrecompPatch = tg.File.expect(
		await tg.include("./perl_cpp_precomp.patch"),
	);
	patches.push(cppPrecompPatch);

	return bootstrap.patch(source, ...(await Promise.all(patches)));
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

	let sourceDir = source_ ?? source();
	let prepare = tg`cp -r ${sourceDir}/. . && chmod -R u+w .`;

	let configure = {
		args: [
			"-des",
			`-Dscriptdir=$OUTPUT/bin`,
			"-Dinstallstyle=lib/perl5",
			"-Dusethreads",
			'-Doptimize="-O3 -pipe -fstack-protector -fwrapv -fno-strict-aliasing"',
		],
		command: "$SHELL Configure",
	};

	let phases = {
		configure,
		prepare,
	};

	let dependencies = [bison(arg), libffi(arg), m4(arg), zlib(arg)];
	let env = [env_, std.utils.env(arg), ...dependencies];

	let perlArtifact = await std.utils.buildUtil(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases,
			prefixArg: "-Dprefix=",
			source: sourceDir,
		},
		autotools,
	);

	let unwrappedPerl = tg.File.expect(await perlArtifact.get("bin/perl"));

	let wrappedPerl = await std.wrap(unwrappedPerl, {
		buildToolchain: env_,
		env: {
			PERL5LIB: tg.Mutation.templatePrepend(
				tg`${perlArtifact}/lib/perl5/${metadata.version}`,
				":",
			),
		},
	});

	let scripts = [];
	let binDir = tg.Directory.expect(await perlArtifact.get("bin"));
	for await (let [name, artifact] of binDir) {
		if (tg.File.is(artifact)) {
			let metadata = await std.file.executableMetadata(artifact);
			if (
				metadata.format == "shebang" &&
				metadata.interpreter.includes("perl")
			) {
				scripts.push(name);
			}
		}
	}

	for (let script of scripts) {
		// Get the script artifact.
		let scriptArtifact = tg.File.expect(
			await perlArtifact.get(`bin/${script}`),
		);

		// Wrap it.
		let wrappedScript = await std.wrap({
			buildToolchain: env_,
			executable: scriptArtifact,
			interpreter: wrappedPerl,
		});

		// Replace in the original artifact.
		perlArtifact = await tg.directory(perlArtifact, {
			[`bin/${script}`]: wrappedScript,
		});
	}

	return tg.directory(perlArtifact, {
		["bin/perl"]: wrappedPerl,
	});
});

export default build;

export let test = tg.target(async () => {
	let host = bootstrap.toolchainTriple(await std.triple.host());
	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });
	let directory = await build({ host, bootstrapMode, env: sdk });
	await std.assert.pkg({
		bootstrapMode,
		directory,
		binaries: ["perl"],
		metadata,
	});
	return directory;
});
