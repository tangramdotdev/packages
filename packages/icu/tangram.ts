import * as python from "python" with { path: "../python" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://icu.unicode.org",
	name: "icu",
	license: "https://github.com/unicode-org/icu?tab=License-1-ov-file#readme",
	repository: "https://github.com/unicode-org/icu",
	version: "76.1",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const owner = "unicode-org";
	const repo = name;
	const checksum =
		"sha256:dfacb46bfe4747410472ce3e1144bf28a102feeaa4e3875bac9b4c6cf30f4f3e";
	const releaseVersion = version.replace(/\./, "-");
	const pkgVersion = version.replace(/\./, "_");
	const pkgName = `icu4c-${pkgVersion}-src`;
	const url = `https://github.com/${owner}/${repo}/releases/download/release-${releaseVersion}/${pkgName}.tgz`;
	const outer = tg.Directory.expect(await std.download({ url, checksum }));
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

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: { python: pythonArg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const os = std.triple.os(host);

	const sourceDir = source_ ?? source();

	const dependencies = [python.toolchain(pythonArg)];
	const env = [...dependencies, env_];

	// On Linux with LLVM, use the filter option to prevent dropping libm.so.1 from the proxied library paths.
	if (
		os === "linux" &&
		((await std.env.tryWhich({ env: env_, name: "clang" })) !== undefined ||
			std.flatten(sdk ?? []).filter((sdk) => sdk?.toolchain === "llvm").length >
				0)
	) {
		env.push({
			TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: "filter",
		});
	}

	const configure = {
		command: tg`${sourceDir}/source/configure`,
		args: ["--enable-static"],
	};
	const phases = { configure };

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

export default default_;

export const test = tg.target(async () => {
	const hasUsage = (name: string) => {
		return {
			name,
			testArgs: ["--help"],
			testPredicate: (stdout: string) =>
				stdout.toLowerCase().includes("usage:"),
		};
	};
	await std.assert.pkg({
		buildFn: default_,
		binaries: [
			"derb",
			hasUsage("genbrk"),
			hasUsage("gencfu"),
			hasUsage("gencnval"),
			hasUsage("gendict"),
			"icuexportdata",
			{ name: "icuinfo", testArgs: [] },
			{
				name: "makeconv",
				testPredicate: (stdout: string) => stdout.includes("6.2"),
			},
			hasUsage("pkgdata"),
		],
		libraries: ["icudata", "icui18n", "icuio", "icutest", "icutu", "icuuc"],
		metadata,
	});
	return true;
});
