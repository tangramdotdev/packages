import * as python from "python" with { path: "../python" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://icu.unicode.org",
	name: "icu",
	license: "https://github.com/unicode-org/icu?tab=License-1-ov-file#readme",
	repository: "https://github.com/unicode-org/icu",
	version: "77.1",
	provides: {
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
	},
};

export const source = tg.command(async () => {
	const { name, version } = metadata;
	const owner = "unicode-org";
	const repo = name;
	const checksum =
		"sha256:588e431f77327c39031ffbb8843c0e3bc122c211374485fa87dc5f3faff24061";
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
		python?: std.args.DependencyArg<python.Arg>;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.command(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: dependencyArgs = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const os = std.triple.os(host);

	const sourceDir = source_ ?? source();

	const dependencies = [
		std.env.envArgFromDependency(
			build,
			env_,
			host,
			sdk,
			std.env.buildDependency(python.self, dependencyArgs.python),
		),
	];
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

export const test = tg.command(async () => {
	const hasUsage = (name: string) => {
		return {
			name,
			testArgs: ["--help"],
			testPredicate: (stdout: string) =>
				stdout.toLowerCase().includes("usage:"),
		};
	};
	const spec = {
		...std.assert.defaultSpec(metadata),
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
