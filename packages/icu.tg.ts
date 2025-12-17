import * as python from "python" with { local: "./python" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://icu.unicode.org",
	name: "icu",
	license: "https://github.com/unicode-org/icu?tab=License-1-ov-file#readme",
	repository: "https://github.com/unicode-org/icu",
	version: "77.1",
	tag: "icu/77.1",
	provides: {
		binaries: [
			"derb",
			"genbrk",
			"gencfu",
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

const deps = await std.deps({
	python: { build: python.self, kind: "buildtime" },
});

export type Arg = std.autotools.Arg &
	std.deps.Arg<typeof deps> & {
		/* Instead of producing an install directory, the output will be the in-tree build directory. Used for cross-compilation. */
		skipInstall?: boolean;
	};

export const build = async (...args: std.Args<Arg>) => {
	// Extract custom options first.
	const customOptions = await std.args.apply<Arg, Arg>({
		args: args as std.Args<Arg>,
		map: async (arg) => arg,
		reduce: {},
	});
	const skipInstall = customOptions.skipInstall ?? false;

	const sourceDir = await tg.resolve(customOptions.source ?? source());

	const prepare = { command: tg.Mutation.prefix("mkdir work && cd work") };
	const configureArgs: tg.Unresolved<Array<tg.Template.Arg>> = [
		"--enable-static",
	];

	// If cross-compiling, we first need to provide a native installation for the build machine.
	const build_ = customOptions.build ?? customOptions.host ?? std.triple.host();
	const host = customOptions.host ?? std.triple.host();
	const isCross = build_ !== host;
	if (isCross) {
		const buildIcu = build({
			build: build_,
			host: build_,
			skipInstall: true,
		});
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
			install: tg`cp -R . ${tg.output}`,
		};
	}

	const arg = await std.autotools.arg(
		{
			source: sourceDir,
			deps,
			buildInTree: !skipInstall,
			phases,
		},
		...args,
	);

	return std.autotools.build(arg);
};

export default build;

export const test = async () => {
	const hasUsage = { testArgs: ["--help"], snapshot: "Usage:" };
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.binaries(metadata.provides.binaries, {
			genbrk: hasUsage,
			gencfu: hasUsage,
			gencnval: { testArgs: ["--help"], snapshot: "usage" },
			gendict: hasUsage,
			icuinfo: { testArgs: [], snapshot: "77.1" },
			makeconv: { snapshot: "6.2" },
			pkgdata: { testArgs: ["--help"], snapshot: "usage:", exitOnErr: false },
		}),
		libraries: [
			{ name: "icudata", pkgConfigName: false },
			{ name: "icui18n", pkgConfigName: "icu-i18n" },
			{ name: "icuio", pkgConfigName: "icu-io" },
			{ name: "icutest", pkgConfigName: false },
			{ name: "icutu", pkgConfigName: false },
			{ name: "icuuc", pkgConfigName: "icu-uc" },
		],
	};
	return await std.assert.pkg(build, spec);
};
