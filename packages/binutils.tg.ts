import * as std from "std" with { local: "./std" };
import * as texinfo from "texinfo" with { local: "./texinfo.tg.ts" };

export const metadata = {
	homepage: "https://www.gnu.org/software/binutils/",
	license: "GPL-3.0-or-later",
	name: "binutils",
	repository: "https://sourceware.org/git/gitweb.cgi?p=binutils-gdb.git",
	version: "2.44",
	tag: "binutils/2.44",
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

export const source = async () => {
	const { name, version } = metadata;

	const checksum =
		"sha256:79cb120b39a195ad588cd354aed886249bfab36c808e746b30208d15271cc95c";

	return std.download.fromGnu({
		name,
		version,
		compression: "zst",
		checksum,
	});
};

export type Arg = std.autotools.Arg & {
	staticBuild?: boolean;
	target?: string;
};

export const build = async (...args: std.Args<Arg>) => {
	// Extract custom options first.
	const customOptions = await std.args.apply<Arg, Arg>({
		args: args as std.Args<Arg>,
		map: async (arg) => arg,
		reduce: {},
	});

	const host = customOptions.host ?? std.triple.host();
	const build_ = customOptions.build ?? host;
	const target = customOptions.target ?? host;
	const staticBuild = customOptions.staticBuild ?? false;

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

	// Collect configuration.
	const configure = {
		args: [
			tg`--with-sysroot=${tg.output}`,
			"--disable-dependency-tracking",
			"--disable-nls",
			`--build=${build_}`,
			`--host=${host}`,
			`--target=${target}`,
			...additionalArgs,
		],
	};

	const phases = {
		configure,
		build: buildPhase,
	};

	const arg = await std.autotools.arg(
		{
			source: source(),
			// texinfo returns an env file, not a directory, so add it directly to env.
			env: std.env.arg(texinfo.build({ build: build_, host }), additionalEnv),
			phases,
		},
		...args,
	);

	return std.autotools.build(arg);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
