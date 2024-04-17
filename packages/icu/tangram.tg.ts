import python from "tg:python" with { path: "../python" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://icu.unicode.org",
	name: "icu",
	license: "https://github.com/unicode-org/icu?tab=License-1-ov-file#readme",
	repository: "https://github.com/unicode-org/icu",
	version: "74.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let owner = "unicode-org";
	let repo = name;
	let extension = ".tar.gz";
	let checksum =
		"sha256:68db082212a96d6f53e35d60f47d38b962e9f9d207a74cfac78029ae8ff5e08c";
	let releaseVersion = version.replace(/\./, "-");
	let pkgVersion = version.replace(/\./, "_");
	let pkgName = `icu4c-${pkgVersion}-src`;
	let url = `https://github.com/${owner}/${repo}/releases/download/release-${releaseVersion}/${pkgName}.tgz`;
	let outer = tg.Directory.expect(await std.download({ url, checksum }));
	return std.directory.unwrap(outer);
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let sourceDir = source_ ?? source();

	let dependencies = [python(arg)];
	let env = [...dependencies, env_];

	let configure = {
		command: tg`${sourceDir}/source/configure`,
		args: ["--enable-static"],
	};
	let phases = { configure };

	let output = await std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases,
			source: sourceDir,
		},
		autotools,
	);

	// Every file in bin/ needs to get wrapped to include lib/.
	let libDir = tg.Directory.expect(await output.get("lib"));
	let binDir = tg.Directory.expect(await output.get("bin"));
	for await (let [name, artifact] of binDir) {
		let unwrappedBin = tg.File.expect(artifact);
		let wrappedBin = std.wrap(unwrappedBin, {
			libraryPaths: [libDir],
		});
		output = await tg.directory(output, {
			[`bin/${name}`]: wrappedBin,
		});
	}

	return output;
});

export default build;

export let test = tg.target(async () => {
	let directory = build();

	await std.assert.pkg({
		directory,
		binaries: [
			"derb",
			"genbrk",
			"gencfu",
			"gencval",
			"gendict",
			"icu-config",
			"icuexportdata",
			"icuinfo",
			"makeconv",
			"pkgdata",
			"uconv",
		],
		libraries: ["icudata", "icui18n", "icuio", "icutest", "icutu", "icuuc"],
		metadata,
	});
	return directory;
});
