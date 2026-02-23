import * as libffi from "libffi" with { local: "../libffi.tg.ts" };
import * as std from "std" with { local: "../std" };
import { $ } from "std" with { local: "../std" };
import * as zlib from "zlib-ng" with { local: "../zlib-ng.tg.ts" };
import patches from "./patches" with { type: "directory" };

export const metadata = {
	homepage: "https://www.perl.org/",
	name: "perl",
	license: "GPL-1.0-or-later",
	repository: "https://github.com/Perl/perl5",
	version: "5.42.0",
	tag: "perl/5.42.0",
	provides: {
		binaries: ["perl"],
	},
};

export const source = async () => {
	const { name, version } = metadata;

	// Download raw source.
	const extension = ".tar.gz";
	const checksum =
		"sha256:e093ef184d7f9a1b9797e2465296f55510adb6dab8842b0c3ed53329663096dc";
	const base = `https://www.cpan.org/src/5.0`;
	return await std.download
		.extractArchive({ base, checksum, extension, name, version })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap)
		.then((source) => std.patch(source, patches));
};

export const deps = () =>
	std.deps({
		libffi: libffi.build,
		zlib: zlib.build,
	});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = async (...args: std.Args<Arg>) => {
	// Build configure args, including OS-specific flags.
	const host =
		(
			await std.args.apply<Arg, Arg>({
				args: args as std.Args<Arg>,
				map: async (arg) => arg,
				reduce: {},
			})
		).host ?? std.triple.host();

	const configureArgs: Array<tg.Template.Arg> = [
		"-des",
		await tg`-Dscriptdir=${tg.output}/bin`,
		"-Dinstallstyle=lib/perl5",
		"-Dusethreads",
		'-Doptimize="-O3 -pipe -fstack-protector -fwrapv -fno-strict-aliasing"',
	];

	// On Linux non-musl hosts, specify that LC_ALL uses name/value pairs.
	if (
		std.triple.os(host) === "linux" &&
		std.triple.environment(host) !== "musl"
	) {
		configureArgs.push("-Accflags=-DPERL_LC_ALL_USES_NAME_VALUE_PAIRS");
	}

	const arg = await std.autotools.arg(
		{
			deps,
			source: source(),
			buildInTree: true,
			prefixArg: "-Dprefix=",
			phases: {
				configure: {
					args: configureArgs,
					command: "bash Configure",
				},
			},
		},
		...args,
	);

	let perlArtifact = await std.autotools.build(arg);

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

	const output = await $`perl -e 'print "hello\n"' > ${tg.output}`
		.env(build())
		.then(tg.File.expect)
		.then((f) => f.text);
	tg.assert(output === "hello\n");

	return true;
};
