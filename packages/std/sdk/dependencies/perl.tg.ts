import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.tg.ts";
import noFixDepsPatch from "./perl_no_fix_deps.patch" with { type: "file" };

export let metadata = {
	name: "perl",
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
	let source = await std
		.download({ url, checksum })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);

	// Apply patches.
	let patches = [];
	patches.push(noFixDepsPatch);

	return bootstrap.patch(source, ...(await Promise.all(patches)));
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let { build, env: env_, host, sdk, source: source_ } = arg ?? {};

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

	let env = std.env.arg(env_, std.utils.env({ build, host, sdk }));

	let perlArtifact = await std.utils.buildUtil({
		...std.triple.rotate({ build, host }),
		buildInTree: true,
		env,
		phases,
		prefixArg: "-Dprefix=",
		sdk,
		source: sourceDir,
	});

	let unwrappedPerl = tg.File.expect(await perlArtifact.get("bin/perl"));

	let wrappedPerl = await std.wrap({
		buildToolchain: bootstrap.sdk(),
		env: {
			PERL5LIB: tg.Mutation.prefix(
				tg`${perlArtifact}/lib/perl5/${metadata.version}`,
				":",
			),
		},
		executable: unwrappedPerl,
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
			return await std.wrap({
				buildToolchain: bootstrap.sdk(),
				executable: scriptArtifact,
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
