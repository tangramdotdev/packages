import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import noFixDepsPatch from "./perl_no_fix_deps.patch" with { type: "file" };
import macosVersionPatch from "./perl_macos_version.patch" with {
	type: "file",
};

export const metadata = {
	name: "perl",
	version: "5.40.2",
};

export const source = tg.command(async (os: string) => {
	const { name, version } = metadata;
	const extension = ".tar.gz";
	const checksum =
		"sha256:10d4647cfbb543a7f9ae3e5f6851ec49305232ea7621aed24c7cfbb0bef4b70d";
	const base = `https://www.cpan.org/src/5.0`;
	const patches = [noFixDepsPatch];
	if (os === "darwin") {
		patches.push(macosVersionPatch);
	}
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap)
		.then((source) => bootstrap.patch(source, ...patches));
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
	const os = std.triple.os(host);
	const build = buildTriple_ ?? host;

	const sourceDir = source_ ?? source(os);

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
	if (os === "linux" && std.triple.environment(host) !== "musl") {
		configure.args.push("-Accflags=-DPERL_LC_ALL_USES_NAME_VALUE_PAIRS");
	}

	const phases = { configure };

	let perlArtifact = await std.utils.autotoolsInternal({
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
