import * as std from "tg:std" with { path: "../std" };
import * as texinfo from "tg:texinfo" with { path: "../texinfo" };

export let metadata = {
	homepage: "https://www.gnu.org/software/binutils/",
	license: "GPL-3.0-or-later",
	name: "binutils",
	repository: "https://sourceware.org/git/gitweb.cgi?p=binutils-gdb.git",
	version: "2.42",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;

	let checksum =
		"sha256:f6e4d41fd5fc778b06b7891457b3620da5ecea1006c6a4a41ae998109f85a800";

	return std.download.fromGnu({
		name,
		version,
		compressionFormat: "xz",
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

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
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
	let target = target_ ?? host;

	let buildPhase = staticBuild
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

	let deps = [texinfo.build({ build, env: env_, host, sdk }, texinfoArg)];
	let env = [...deps, additionalEnv, env_];

	// Collect configuration.
	let configure = {
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

	let phases = {
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

export default build;

export let test = tg.target(async () => {
	let binaries = [
		"ar",
		"as",
		"ld",
		"nm",
		"objcopy",
		"objdump",
		"ranlib",
		"strip",
	];

	await std.assert.pkg({
		buildFunction: build,
		binaries,
		metadata,
	});
	return true;
});
