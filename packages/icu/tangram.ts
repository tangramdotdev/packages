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

export const build = tg.target(async (...args: std.Args<Arg>) => {
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

	const dependencies = [python.self(pythonArg)];
	const env = [...dependencies, env_];

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

export default build;

export const provides = {
	binaries: [
		"derb",
		"genbrk",
		"genfcu",
		"gencnval",
		"gendict",
		"icuexportdata",
		"icuinfo",
		"makeconv",
		"pkgdata",
		"uconv",
	],
	libraries: ["icudata", "icui18n", "icuio", "icutest", "icutu", "icuuc"],
};

export const test = tg.target(async () => {
	const hasUsage = (name: string) => {
		return {
			name,
			testArgs: ["--help"],
			testPredicate: (stdout: string) =>
				stdout.toLowerCase().includes("usage:"),
		};
	};
	const spec = {
		...std.assert.defaultSpec(provides, metadata),
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
			hasUsage("uconv"),
		],
	};
	return await std.assert.pkg(build, spec);
});
