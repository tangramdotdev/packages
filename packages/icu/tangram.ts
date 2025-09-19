import * as python from "python" with { local: "../python" };
import * as std from "std" with { local: "../std" };

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

export const source = async () => {
	const { name, version } = metadata;
	const owner = "unicode-org";
	const repo = name;
	const checksum =
		"sha256:588e431f77327c39031ffbb8843c0e3bc122c211374485fa87dc5f3faff24061";
	const releaseVersion = version.replace(/\./, "-");
	const pkgVersion = version.replace(/\./, "_");
	const pkgName = `icu4c-${pkgVersion}-src`;
	const url = `https://github.com/${owner}/${repo}/releases/download/release-${releaseVersion}/${pkgName}.tgz`;
	const outer = await std.download
		.extractArchive({ url, checksum })
		.then(tg.Directory.expect);
	return std.directory.unwrap(outer);
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		python?: std.args.DependencyArg<python.Arg>;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	/* Instead of producing an install directory, the output will be the in-tree build directory. Used for cross-compilation. */
	skipInstall?: boolean;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build: build_,
		dependencies: dependencyArgs = {},
		env: env_,
		host,
		sdk,
		skipInstall = false,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const sourceDir = source_ ?? source();

	const dependencies = [
		std.env.envArgFromDependency(
			build_,
			env_,
			host,
			sdk,
			std.env.buildDependency(python.self, dependencyArgs.python),
		),
	];
	const env = [...dependencies, env_];

	const prepare = { command: tg.Mutation.prefix("mkdir work && cd work") };
	const configureArgs: tg.Unresolved<Array<tg.Template.Arg>> = [
		"--enable-static",
	];

	// If cross-compiling, we first need to provide a native installation for the build machine.
	const isCross = build_ !== host;
	if (isCross) {
		const buildIcu = build({ build: build_, host: build_, skipInstall: true });
		configureArgs.push(tg`--with-cross-build=${buildIcu}`);
		// FIXME - fix the failing configure check, this is a hack.
		configureArgs.push("ac_cv_c_bigendian=no");
	}
	const configure = {
		command: tg`${sourceDir}/source/configure`,
		args: configureArgs,
	};

	let phases: tg.Unresolved<std.phases.Arg> = { prepare, configure };
	if (skipInstall) {
		phases = {
			...phases,
			install: {
				command: tg.Mutation.set(`cp -R . $OUTPUT`),
				args: tg.Mutation.unset(),
			},
		};
	}

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build: build_, host })),
			buildInTree: !skipInstall,
			env: std.env.arg(...env),
			phases,
			sdk,
			source: sourceDir,
		},
		autotools,
	);
};

export default build;

export const test = async () => {
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
			{ ...hasUsage("pkgdata"), exitOnErr: false },
		],
	};
	return await std.assert.pkg(build, spec);
};
