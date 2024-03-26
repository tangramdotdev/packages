import bison from "tg:bison" with { path: "../bison" };
import libffi from "tg:libffi" with { path: "../libffi" };
import m4 from "tg:m4" with { path: "../m4" };
import * as std from "tg:std" with { path: "../std" };
import zlib from "tg:zlib" with { path: "../zlib" };

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

	return std.patch(source, ...(await Promise.all(patches)));
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let perl = tg.target(async (arg?: Arg) => {
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
	let env = [...dependencies, env_];

	let perlArtifact = await std.autotools.build(
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

	let wrappedPerl = await std.wrap(
		tg.symlink({ artifact: perlArtifact, path: "bin/perl" }),
		{
			env: {
				PERL5LIB: tg.Mutation.templateAppend(
					tg`${perlArtifact}/lib/perl5/${metadata.version}`,
					":",
				),
			},
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

export default perl;

/** Wrap a shebang'd perl script to use this package's bach as the interpreter.. */
export let wrapScript = async (script: tg.File) => {
	let scriptMetadata = await std.file.executableMetadata(script);
	if (
		scriptMetadata?.format !== "shebang" ||
		!scriptMetadata.interpreter.includes("perl")
	) {
		throw new Error("Expected a shebang sh or bash script");
	}
	let interpreter = tg.File.expect(await (await perl()).get("bin/bash"));
	return std.wrap(script, { interpreter, identity: "executable" });
};

export let test = tg.target(async () => {
	let directory = perl();
	await std.assert.pkg({
		directory,
		binaries: ["perl"],
		metadata,
	});
	return directory;
});
