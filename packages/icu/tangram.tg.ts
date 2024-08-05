import * as python from "tg:python" with { path: "../python" };
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

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		python?: python.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		dependencies: { python: pythonArg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let os = std.triple.os(host);

	let sourceDir = source_ ?? source();

	let dependencies = [python.toolchain(pythonArg)];
	let env = [...dependencies, env_];

	// On Linux with LLVM, use the filter option to prevent dropping libm.so.1 from the proxied library paths.
	if (
		os === "linux" &&
		((await std.env.tryWhich({ env: env_, name: "clang" })) !== undefined ||
			std.flatten(sdk ?? []).filter((sdk) => sdk?.toolchain === "llvm").length >
				0)
	) {
		env.push({
			TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: "filter", // FIXME - is this necessary?
		});
	}

	let configure = {
		command: tg`${sourceDir}/source/configure`,
		args: ["--enable-static"],
	};
	let phases = { configure };

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(env),
			phases,
			sdk,
			source: sourceDir,
		},
		autotools,
	);
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
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
