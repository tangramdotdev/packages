import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.tg.ts";
import bison from "./bison.tg.ts";
import libffi from "./libffi.tg.ts";
import m4 from "./m4.tg.ts";
import make from "./make.tg.ts";
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

	let dependencies = [bison(arg), libffi(arg), m4(arg), make(arg), zlib(arg)];
	let env = [std.utils.env(arg), ...dependencies, env_];

	let perlArtifact = await std.utils.buildUtil(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			env,
			phases,
			prefixArg: "-Dprefix=",
			source: sourceDir,
		},
		autotools,
	);

	let wrappedPerl = await std.wrap(
		tg.symlink({ artifact: perlArtifact, path: "bin/perl" }),
		{
			identity: "wrapper",
			env: {
				PERL5LIB: tg.Mutation.templateAppend(
					tg`${perlArtifact}/lib/perl5/${metadata.version}`,
					":",
				),
			},
			sdk: rest.sdk,
		},
	);

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
		let wrappedScript = std.wrap(scriptArtifact, {
			identity: "interpreter",
			interpreter: wrappedPerl,
			sdk: rest.sdk,
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
	await std.assert.pkg({
		directory: build({ sdk: { bootstrapMode: true } }),
		binaries: ["perl"],
		metadata,
	});
	return true;
});
