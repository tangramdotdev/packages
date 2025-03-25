import * as std from "std" with { path: "../std" };
import * as texinfo from "texinfo" with { path: "../texinfo" };

export const metadata = {
	homepage: "https://www.gnu.org/software/binutils/",
	license: "GPL-3.0-or-later",
	name: "binutils",
	repository: "https://sourceware.org/git/gitweb.cgi?p=binutils-gdb.git",
	version: "2.44",
	provides: {
		binaries: [
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
		],
	},
};

export const source = tg.command(async () => {
	const { name, version } = metadata;

	const checksum =
		"sha256:79cb120b39a195ad588cd354aed886249bfab36c808e746b30208d15271cc95c";

	return std.download.fromGnu({
		name,
		version,
		compression: "zst",
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

export const build = tg.command(async (...args: std.Args<Arg>) => {
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

	const deps = [texinfo.build({ build, env: env_, host, sdk }, texinfoArg)];
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

export default build;

export const test = tg.command(async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
});
