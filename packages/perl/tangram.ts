import * as libffi from "libffi" with { local: "../libffi" };
import * as std from "std" with { local: "../std" };
import { $ } from "std" with { local: "../std" };
import * as zlib from "zlib" with { local: "../zlib" };
import patches from "./patches" with { type: "directory" };

export const metadata = {
	homepage: "https://www.perl.org/",
	name: "perl",
	license: "GPL-1.0-or-later",
	repository: "https://github.com/Perl/perl5",
	version: "5.40.2",
	provides: {
		binaries: ["perl"],
	},
};

export const source = async () => {
	const { name, version } = metadata;

	// Download raw source.
	const extension = ".tar.gz";
	const checksum =
		"sha256:10d4647cfbb543a7f9ae3e5f6851ec49305232ea7621aed24c7cfbb0bef4b70d";
	const base = `https://www.cpan.org/src/5.0`;
	return await std.download
		.extractArchive({ base, checksum, extension, name, version })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap)
		.then((source) => std.patch(source, patches));
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		libffi?: boolean | std.args.DependencyArg<libffi.Arg>;
		zlib?: boolean | std.args.DependencyArg<zlib.Arg>;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const defaultDependencies = {
		libffi: true,
		zlib: true,
	};

	const {
		autotools = {},
		build,
		dependencies: dependencyArgs = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(
		{ dependencies: defaultDependencies },
		...args,
	);

	const sourceDir = source_ ?? source();

	const dependencies = [];
	if (dependencyArgs.libffi !== undefined) {
		dependencies.push(
			std.env.runtimeDependency(libffi.build, dependencyArgs.libffi),
		);
	}
	if (dependencyArgs.zlib !== undefined) {
		dependencies.push(
			std.env.runtimeDependency(zlib.build, dependencyArgs.zlib),
		);
	}

	// Resolve env.
	const env = std.env.arg(
		...dependencies.map((dep) =>
			std.env.envArgFromDependency(build, env_, host, sdk, dep),
		),
		env_,
	);

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
		tg.symlink({ artifact: perlArtifact, path: "bin/perl" }),
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
};

export default build;

/** Wrap a shebang'd perl script to use this package's bach as the interpreter.. */
export const wrapScript = async (script: tg.File) => {
	const scriptMetadata = await std.file.executableMetadata(script);
	if (
		scriptMetadata?.format !== "shebang" ||
		!scriptMetadata.interpreter.includes("perl")
	) {
		throw new Error("Expected a shebang sh or bash script");
	}
	const interpreter = tg.File.expect(await (await build()).get("bin/bash"));
	return std.wrap(script, { interpreter });
};

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	await std.assert.pkg(build, spec);

	const output = await $`perl -e 'print "hello\n"' > $OUTPUT`
		.env(build())
		.then(tg.File.expect)
		.then((f) => f.text());
	tg.assert(output === "hello\n");

	return true;
};
