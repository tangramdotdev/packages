import * as python from "python" with { local: "./python" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://icu.unicode.org",
	name: "icu",
	license: "https://github.com/unicode-org/icu?tab=License-1-ov-file#readme",
	repository: "https://github.com/unicode-org/icu",
	version: "78.2",
	tag: "icu/78.2",
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
	const tag = `release-${version}`;
	const checksum =
		"sha256:3e99687b5c435d4b209630e2d2ebb79906c984685e78635078b672e03c89df35";
	const pkgName = `icu4c-${version}-sources`;
	const url = `https://github.com/${owner}/${repo}/releases/download/${tag}/${pkgName}.tgz`;
	return std.download
		.extractArchive({ url, checksum })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export const deps = () =>
	std.deps({
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

	return std.autotools.build(
		{
			build: build_,
			buildInTree: !skipInstall,
			deps,
			host,
			phases,
			source: sourceDir,
		},
		...args,
	);
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
			icuinfo: { testArgs: [], snapshot: "78.2" },
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
