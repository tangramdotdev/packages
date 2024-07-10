import * as bison from "tg:bison" with { path: "../bison" };
import * as libffi from "tg:libffi" with { path: "../libffi" };
import * as m4 from "tg:m4" with { path: "../m4" };
import * as std from "tg:std" with { path: "../std" };
import * as zlib from "tg:zlib" with { path: "../zlib" };
import patches from "./patches" with { type: "directory" };

export let metadata = {
	homepage: "https://www.perl.org/",
	name: "perl",
	license: "GPL-1.0-or-later",
	repository: "https://github.com/Perl/perl5",
	version: "5.38.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;

	// Download raw source.
	let extension = ".tar.gz";
	let packageArchive = std.download.packageArchive({
		extension,
		name,
		version,
	});
	let checksum =
		"sha256:a0a31534451eb7b83c7d6594a497543a54d488bc90ca00f5e34762577f40655e";
	let url = `https://www.cpan.org/src/5.0/${packageArchive}`;
	let source = tg.Directory.expect(await std.download({ url, checksum }));
	source = await std.directory.unwrap(source);

	// Apply patches.
	let patchFiles = [];
	for await (let [_, artifact] of patches) {
		if (artifact instanceof tg.File) {
			patchFiles.push(artifact);
		}
	}

	return std.patch(source, ...(await Promise.all(patchFiles)));
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		libffi?: libffi.Arg;
		zlib?: zlib.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build: build_,
		dependencies: { libffi: libffiArg = {}, zlib: zlibArg = {} } = {},
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let sourceDir = source_ ?? source();

	// Set up default build dependencies.
	let buildDependencies = [];
	let m4ForBuild = m4.build({ build, host: build }).then((d) => {
		return { M4: std.directory.keepSubdirectories(d, "bin") };
	});
	buildDependencies.push(m4ForBuild);
	let bisonForBuild = bison.build({ build, host: build }).then((d) => {
		return { BISON: std.directory.keepSubdirectories(d, "bin") };
	});
	buildDependencies.push(bisonForBuild);

	// Set up host dependencies.
	let hostDependencies = [];
	let libffiForHost = await libffi
		.build({ build, host, sdk }, libffiArg)
		.then((d) => std.directory.keepSubdirectories(d, "include", "lib"));
	hostDependencies.push(libffiForHost);
	let zlibForHost = await zlib
		.build({ build, host, sdk }, zlibArg)
		.then((d) => std.directory.keepSubdirectories(d, "include", "lib"));
	hostDependencies.push(zlibForHost);

	// Resolve env.
	let env = await std.env.arg(...buildDependencies, ...hostDependencies, env_);

	// Add final build dependencies to environment.
	let resolvedBuildDependencies = [];
	let finalM4 = await std.env.getArtifactByKey({ env, key: "M4" });
	resolvedBuildDependencies.push(finalM4);
	let finalBison = await std.env.getArtifactByKey({ env, key: "BISON" });
	resolvedBuildDependencies.push(finalBison);
	env = await std.env.arg(env, ...resolvedBuildDependencies);

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

	let phases = { configure };

	let perlArtifact = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			buildInTree: true,
			env,
			phases,
			prefixArg: "-Dprefix=",
			sdk,
			source: sourceDir,
		},
		autotools,
	);

	let wrappedPerl = await std.wrap(
		tg.symlink({ artifact: perlArtifact, path: tg.Path.new("bin/perl") }),
		{
			env: {
				PERL5LIB: tg.Mutation.suffix(
					tg`${perlArtifact}/lib/perl5/${metadata.version}`,
					":",
				),
			},
		},
	);

	let scripts = [];
	let binDir = tg.Directory.expect(await perlArtifact.get("bin"));
	for await (let [name, artifact] of binDir) {
		if (artifact instanceof tg.File) {
			let metadata = await std.file.executableMetadata(artifact);
			if (
				metadata.format == "shebang" &&
				metadata.interpreter.includes("perl")
			) {
				scripts.push(name);
			}
		}
	}

	let wrappedScripts = await Promise.all(
		scripts.map(async (script) => {
			// Get the script artifact.
			let scriptArtifact = perlArtifact
				.get(`bin/${script}`)
				.then(tg.File.expect);

			// Wrap it.
			return await std.wrap(scriptArtifact, {
				interpreter: wrappedPerl,
			});
		}),
	);

	for (let script of wrappedScripts) {
		// Replace in the original artifact.
		perlArtifact = await tg.directory(perlArtifact, {
			[`bin/${script}`]: script,
		});
	}

	return tg.directory(perlArtifact, {
		["bin/perl"]: wrappedPerl,
	});
});

export default build;

/** Wrap a shebang'd perl script to use this package's bach as the interpreter.. */
export let wrapScript = async (script: tg.File) => {
	let scriptMetadata = await std.file.executableMetadata(script);
	if (
		scriptMetadata?.format !== "shebang" ||
		!scriptMetadata.interpreter.includes("perl")
	) {
		throw new Error("Expected a shebang sh or bash script");
	}
	let interpreter = tg.File.expect(await (await build()).get("bin/bash"));
	return std.wrap(script, { interpreter, identity: "executable" });
};

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["perl"],
		metadata,
	});
	return true;
});
