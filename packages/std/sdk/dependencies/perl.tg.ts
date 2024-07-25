import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.tg.ts";
import noFixDepsPatch from "./perl_no_fix_deps.patch" with { type: "file" };

export let metadata = {
	name: "perl",
	version: "5.38.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let extension = ".tar.gz";
	let checksum =
		"sha256:a0a31534451eb7b83c7d6594a497543a54d488bc90ca00f5e34762577f40655e";
	let base = `https://www.cpan.org/src/5.0`;
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

export let build = tg.target(async (arg?: Arg) => {
	let { build, env, host, sdk, source: source_ } = arg ?? {};

	let sourceDir = source_ ?? source();

	let configure = {
		args: [
			"-des",
			"-Dscriptdir=$OUTPUT/bin",
			"-Dinstallstyle=lib/perl5",
			"-Dusethreads",
			'-Doptimize="-O3 -pipe -fstack-protector -fwrapv -fno-strict-aliasing"',
		],
		command: "$SHELL Configure",
	};

	let phases = { configure };

	let perlArtifact = await std.utils.buildUtil({
		...(await std.triple.rotate({ build, host })),
		buildInTree: true,
		env,
		phases,
		prefixArg: "-Dprefix=",
		sdk,
		source: sourceDir,
	});

	let unwrappedPerl = tg.File.expect(await perlArtifact.get("bin/perl"));

	let wrappedPerl = await std.wrap(unwrappedPerl, {
		buildToolchain: env,
		env: {
			PERL5LIB: tg.Mutation.prefix(
				tg`${perlArtifact}/lib/perl5/${metadata.version}`,
				":",
			),
		},
	});

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
			return [
				script,
				await std.wrap(scriptArtifact, {
					buildToolchain: env,
					interpreter: wrappedPerl,
				}),
			];
		}),
	);

	for (let [scriptName, artifact] of wrappedScripts) {
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

export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdkArg = await bootstrap.sdk.arg(host);
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["perl"],
		metadata,
		sdk: sdkArg,
	});
	return true;
});
