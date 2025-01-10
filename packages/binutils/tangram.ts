import * as std from "std" with { path: "../std" };
import * as texinfo from "texinfo" with { path: "../texinfo" };

export const metadata = {
	homepage: "https://www.gnu.org/software/binutils/",
	license: "GPL-3.0-or-later",
	name: "binutils",
	repository: "https://sourceware.org/git/gitweb.cgi?p=binutils-gdb.git",
	version: "2.43",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;

	const checksum =
		"sha256:ba5e600af2d0e823312b4e04d265722594be7d94906ebabe6eaf8d0817ef48ed";

	return std.download.fromGnu({
		name,
		version,
		compressionFormat: "zst",
		checksum,
	});
});

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		texinfo?: texinfo.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
	staticBuild?: boolean;
	target?: string;
};

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: { texinfo: texinfoArg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
		staticBuild,
		target: target_,
		...rest
	} = await std.args.apply<Arg>(...args);
	const target = target_ ?? host;

	const buildPhase = staticBuild
		? `make configure-host && make LDFLAGS=-all-static`
		: `make`;

	let additionalEnv: std.env.Arg = {};
	let additionalArgs: Array<string> = [];
	if (staticBuild) {
		additionalEnv = {
			...additionalEnv,
			CC: await tg`${target}-cc --static -fPIC`,
			CXX: await tg`${target}-c++ -static-libstdc++ -fPIC`,
		};
		additionalArgs = [
			"--enable-shared=no",
			"--enable-static=yes",
			"--enable-static-link",
			"--disable-shared-plugins",
			"--disable-dynamicplugin",
		];
		if (std.triple.environment(target) === "musl") {
			/*
				Support musl >= 1.2.4 pending an upstream fix to binutils.
				https://musl.libc.org/releases.html
				"On the API level, the legacy "LFS64" ("large file support") interfaces, which were provided by macros remapping them to their standard names (#define stat64 stat and similar) have been deprecated and are no longer provided under the _GNU_SOURCE feature profile, only under explicit _LARGEFILE64_SOURCE. The latter will also be removed in a future version. Builds broken by this change can be fixed short-term by adding -D_LARGEFILE64_SOURCE to CFLAGS, but should be fixed to use the standard interfaces."
			*/
			additionalEnv = {
				...additionalEnv,
				CFLAGS: await tg.Mutation.prefix("-D_LARGEFILE64_SOURCE", " "),
			};
		}
	}

	const deps = [texinfo.default_({ build, env: env_, host, sdk }, texinfoArg)];
	const env = [...deps, additionalEnv, env_];

	// Collect configuration.
	const configure = {
		args: [
			`--with-sysroot=$OUTPUT`,
			"--disable-dependency-tracking",
			"--disable-nls",
			`--build=${build}`,
			`--host=${host}`,
			`--target=${target}`,
			...additionalArgs,
		],
	};

	const phases = {
		configure,
		build: buildPhase,
	};

	return std.autotools.build(
		{
			...rest,
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(env),
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default default_;

export const test = tg.target(async () => {
	const os = std.triple.os(await std.triple.host());

	const binaries =
		os === "linux"
			? ["ar", "as", "ld", "nm", "objcopy", "objdump", "ranlib", "strip"]
			: [
					"addr2line",
					"ar",
					"c++filt",
					"elfedit",
					"nm",
					"objcopy",
					"objdump",
					"ranlib",
					"readelf",
					"size",
					"strings",
					"strip",
				];

	await std.assert.pkg({ buildFn: default_, binaries, metadata });
	return true;
});
