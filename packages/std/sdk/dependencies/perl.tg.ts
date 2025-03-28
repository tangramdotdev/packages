import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.ts";
import noFixDepsPatch from "./perl_no_fix_deps.patch" with { type: "file" };

export const metadata = {
	name: "perl",
	version: "5.40.1",
};

export const source = tg.command(async () => {
	const { name, version } = metadata;
	const extension = ".tar.gz";
	const checksum =
		"sha256:02f8c45bb379ed0c3de7514fad48c714fd46be8f0b536bfd5320050165a1ee26";
	const base = `https://www.cpan.org/src/5.0`;
	return await std
		.download({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap)
		.then((source) => bootstrap.patch(source, noFixDepsPatch));
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export const build = tg.command(async (arg?: Arg) => {
	const {
		build: buildTriple_,
		env,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};
	const host = host_ ?? (await std.triple.host());
	const build = buildTriple_ ?? host;

	const sourceDir = source_ ?? source();

	const configure = {
		args: [
			"-des",
			"-Dscriptdir=$OUTPUT/bin",
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

	let perlArtifact = await std.utils.buildUtil({
		...(await std.triple.rotate({ build, host })),
		buildInTree: true,
		env,
		phases,
		prefixArg: "-Dprefix=",
		sdk,
		source: sourceDir,
	});

	const unwrappedPerl = tg.File.expect(await perlArtifact.get("bin/perl"));

	const wrappedPerl = await std.wrap(unwrappedPerl, {
		buildToolchain: env,
		env: {
			PERL5LIB: tg.Mutation.prefix(
				tg`${perlArtifact}/lib/perl5/${metadata.version}`,
				":",
			),
		},
	});

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
					buildToolchain: env,
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

export default build;

export const test = tg.command(async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const sdkArg = await bootstrap.sdk.arg(host);
	// FIXME
	// await std.assert.pkg({ buildFn: build, binaries: ["perl"], metadata });
	return true;
});
