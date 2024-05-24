import python from "tg:python" with { path: "../python" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://icu.unicode.org",
	name: "icu",
	license: "https://github.com/unicode-org/icu?tab=License-1-ov-file#readme",
	repository: "https://github.com/unicode-org/icu",
	version: "75.1",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let owner = "unicode-org";
	let repo = name;
	let checksum =
		"sha256:cb968df3e4d2e87e8b11c49a5d01c787bd13b9545280fc6642f826527618caef";
	let releaseVersion = version.replace(/\./, "-");
	let pkgVersion = version.replace(/\./, "_");
	let pkgName = `icu4c-${pkgVersion}-src`;
	let url = `https://github.com/${owner}/${repo}/releases/download/release-${releaseVersion}/${pkgName}.tgz`;
	let outer = tg.Directory.expect(await std.download({ url, checksum }));
	return std.directory.unwrap(outer);
});

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let icu = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;
	let os = std.triple.os(host);

	let sourceDir = source_ ?? source();

	let dependencies = [python({ build, env: env_, host, sdk })];
	let env = [...dependencies, env_];

	// On Linux with LLVM, use the filter option to prevent dropping libm.so.1 from the proxied library paths.
	if (
		os === "linux" &&
		((await std.env.tryWhich({ env: env_, name: "clang" })) !== undefined ||
			std
				.flatten(sdk ?? [])
				.filter(
					(sdk) =>
						sdk !== undefined &&
						typeof sdk === "object" &&
						sdk?.toolchain === "llvm",
				).length > 0)
	) {
		env.push({
			TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: "filter",
		});
	}

	let configure = {
		command: tg`${sourceDir}/source/configure`,
		args: ["--enable-static"],
	};
	let phases = { configure };

	let output = await std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			env: std.env.arg(env),
			phases,
			sdk,
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

export default icu;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: icu,
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
	return true;
});
