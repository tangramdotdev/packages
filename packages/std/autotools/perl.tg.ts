import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import noFixDepsPatch from "./perl_no_fix_deps.patch" with { type: "file" };

export const metadata = {
	name: "perl",
	version: "5.42.0",
	tag: "perl/5.42.0",
};

export const source = async (os: string) => {
	const { name, version } = metadata;
	const extension = ".tar.gz";
	const checksum =
		"sha256:e093ef184d7f9a1b9797e2465296f55510adb6dab8842b0c3ed53329663096dc";
	const base = `https://www.cpan.org/src/5.0`;
	const patches = [noFixDepsPatch];
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap)
		.then((source) => bootstrap.patch(source, ...patches));
};

export type Arg = {
	bootstrap?: boolean;
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (arg?: tg.Unresolved<Arg>) => {
	const {
		bootstrap: bootstrap_ = false,
		build: buildTriple_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ? await tg.resolve(arg) : {};
	const host = host_ ?? std.triple.host();
	const os = std.triple.os(host);
	const build = buildTriple_ ?? host;

	const sourceDir = source_ ?? source(os);

	const configure = {
		args: [
			"-des",
			tg`-Dscriptdir=${tg.output}/bin`,
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

	const env = await std.env.arg(env_, { utils: false });

	let perlArtifact = await std.utils.autotoolsInternal({
		build,
		host,
		bootstrap: bootstrap_,
		buildInTree: true,
		env,
		phases,
		prefixArg: "-Dprefix=",
		processName: metadata.name,
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
};

export default build;

export const test = async () => {
	const host = bootstrap.toolchainTriple(std.triple.host());
	const sdkArg = await bootstrap.sdk.arg(host);
	// FIXME
	// await std.assert.pkg({ buildFn: build, binaries: ["perl"], metadata });
	return true;
};
