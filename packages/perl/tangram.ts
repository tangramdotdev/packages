import * as bison from "bison" with { path: "../bison" };
import * as libffi from "libffi" with { path: "../libffi" };
import * as m4 from "m4" with { path: "../m4" };
import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };
import * as zlib from "zlib" with { path: "../zlib" };
import patches from "./patches" with { type: "directory" };

export const metadata = {
	homepage: "https://www.perl.org/",
	name: "perl",
	license: "GPL-1.0-or-later",
	repository: "https://github.com/Perl/perl5",
	version: "5.40.0",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;

	// Download raw source.
	const extension = ".tar.gz";
	const checksum =
		"sha256:c740348f357396327a9795d3e8323bafd0fe8a5c7835fc1cbaba0cc8dfe7161f";
	const base = `https://www.cpan.org/src/5.0`;
	return await std
		.download({ base, checksum, extension, name, version })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap)
		.then((source) => std.patch(source, patches));
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

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build: build_,
		dependencies: { libffi: libffiArg = {}, zlib: zlibArg = {} } = {},
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const sourceDir = source_ ?? source();

	// Set up default build dependencies.
	const buildDependencies = [];
	const m4ForBuild = m4.default_({ build, host: build }).then((d) => {
		return { M4: std.directory.keepSubdirectories(d, "bin") };
	});
	buildDependencies.push(m4ForBuild);
	const bisonForBuild = bison.default_({ build, host: build }).then((d) => {
		return { BISON: std.directory.keepSubdirectories(d, "bin") };
	});
	buildDependencies.push(bisonForBuild);

	// Set up host dependencies.
	const hostDependencies = [];
	const libffiForHost = await libffi
		.default_({ build, host, sdk }, libffiArg)
		.then((d) => std.directory.keepSubdirectories(d, "include", "lib"));
	hostDependencies.push(libffiForHost);
	const zlibForHost = await zlib
		.default_({ build, host, sdk }, zlibArg)
		.then((d) => std.directory.keepSubdirectories(d, "include", "lib"));
	hostDependencies.push(zlibForHost);

	// Resolve env.
	let env = await std.env.arg(...buildDependencies, ...hostDependencies, env_);

	// Add final build dependencies to environment.
	const resolvedBuildDependencies = [];
	const finalM4 = await std.env.getArtifactByKey({ env, key: "M4" });
	resolvedBuildDependencies.push(finalM4);
	const finalBison = await std.env.getArtifactByKey({ env, key: "BISON" });
	resolvedBuildDependencies.push(finalBison);
	env = await std.env.arg(env, ...resolvedBuildDependencies);

	const configure = {
		args: [
			"-des",
			`-Dscriptdir=$OUTPUT/bin`,
			"-Dinstallstyle=lib/perl5",
			"-Dusethreads",
			'-Doptimize="-O3 -pipe -fstack-protector -fwrapv -fno-strict-aliasing"',
		],
		command: "$SHELL Configure",
	};

	// On Linux non-musl hosts, specify that LC_ALL uses name/value pairs.
	if (
		std.triple.os(host) === "linux" &&
		std.triple.environment(host) !== "musl"
	) {
		configure.args.push("-Accflags=-DPERL_LC_ALL_USES_NAME_VALUE_PAIRS");
	}

	const phases = { configure };

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

	const wrappedPerl = await std.wrap(
		tg.symlink({ artifact: perlArtifact, subpath: "bin/perl" }),
		{
			env: {
				PERL5LIB: tg.Mutation.suffix(
					tg`${perlArtifact}/lib/perl5/${metadata.version}`,
					":",
				),
			},
		},
	);

	const scripts = [];
	const binDir = tg.Directory.expect(await perlArtifact.get("bin"));
	for await (const [name, artifact] of binDir) {
		if (artifact instanceof tg.File) {
			const metadata = await std.file.executableMetadata(artifact);
			if (
				metadata.format == "shebang" &&
				metadata.interpreter.includes("perl")
			) {
				scripts.push(name);
			}
		}
	}

	const wrappedScripts = await Promise.all(
		scripts.map(async (script) => {
			// Get the script artifact.
			const scriptArtifact = perlArtifact
				.get(`bin/${script}`)
				.then(tg.File.expect);

			// Wrap it.
			return [
				script,
				await std.wrap(scriptArtifact, {
					interpreter: wrappedPerl,
				}),
			];
		}),
	);

	for (const [scriptName, artifact] of wrappedScripts) {
		// Replace in the original artifact.
		perlArtifact = await tg.directory(perlArtifact, {
			[`bin/${scriptName}`]: artifact,
		});
	}

	return tg.directory(perlArtifact, {
		["bin/perl"]: wrappedPerl,
	});
});

export default default_;

/** Wrap a shebang'd perl script to use this package's bach as the interpreter.. */
export const wrapScript = async (script: tg.File) => {
	const scriptMetadata = await std.file.executableMetadata(script);
	if (
		scriptMetadata?.format !== "shebang" ||
		!scriptMetadata.interpreter.includes("perl")
	) {
		throw new Error("Expected a shebang sh or bash script");
	}
	const interpreter = tg.File.expect(await (await default_()).get("bin/bash"));
	return std.wrap(script, { interpreter, identity: "executable" });
};

export const test = tg.target(async () => {
	await std.assert.pkg({ buildFn: default_, binaries: ["perl"], metadata });

	const output = await $`perl -e 'print "hello\n"' > $OUTPUT`
		.env(default_())
		.then(tg.File.expect)
		.then((f) => f.text());
	tg.assert(output === "hello\n");

	return true;
});
