import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";

export let metadata = {
	name: "binutils",
	version: "2.42",
};

export let source = tg.target(async (build: string) => {
	let { name, version } = metadata;

	let checksum =
		"sha256:f6e4d41fd5fc778b06b7891457b3620da5ecea1006c6a4a41ae998109f85a800";

	let unpatchedSource = std.download.fromGnu({
		name,
		version,
		compressionFormat: "xz",
		checksum,
	});

	let utils = bootstrap.utils(build);

	// Work around an issue regarding libtool and sysroots. See: https://www.linuxfromscratch.org/lfs/view/stable/chapter06/binutils-pass2.html
	let script = tg`
		mkdir -p $OUTPUT
		cp -R ${unpatchedSource}/* $OUTPUT
		chmod -R u+w $OUTPUT
		cd $OUTPUT
		sed '6009s/$add_dir//' -i ltmain.sh
	`;
	let result = tg.Directory.expect(
		await tg.build(script, { env: std.env.arg(utils) }),
	);
	return result;
});

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
	staticBuild?: boolean;
	target?: string;
};

/** Obtain the GNU binutils. */
export let build = tg.target(async (arg?: Arg) => {
	let {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
		staticBuild,
		target: target_,
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;
	let target = target_ ?? host;

	// NOTE: We could pull in `dependencies.texinfo` to avoid needing to set `MAKEINFO=true`, but we do not need the docs here and texinfo transitively adds more rebuilds than the other required dependencies, which would increase the total build time needlessly.
	let buildPhase = staticBuild
		? `make MAKEINFO=true configure-host && make MAKEINFO=true LDFLAGS=-all-static`
		: `make MAKEINFO=true`;

	let additionalEnv: std.env.Arg = {};
	let additionalArgs: Array<string> = [];
	if (staticBuild) {
		additionalEnv = {
			...additionalEnv,
			CC: await tg`${target}-cc --static -fPIC`,
			CC_FOR_BUILD: `cc --static -fPIC`,
			CXX: await tg`${target}-c++ -static-libstdc++ -fPIC`,
			CXX_FOR_BUILD: `c++ -static-libstdc++ -fPIC`,
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

	let deps = [std.utils.env({ host: build, sdk })];
	let env = std.env.arg(env_, ...deps, additionalEnv);

	// Collect configuration.
	let configure = {
		args: [
			`--with-sysroot=$OUTPUT`,
			"--disable-dependency-tracking",
			"--disable-nls",
			"--disable-werror",
			"--enable-gprofng=no",
			`--build=${build}`,
			`--host=${host}`,
			`--target=${target}`,
			...additionalArgs,
		],
	};

	let phases = {
		configure,
		build: buildPhase,
		install: tg.Mutation.set("make MAKEINFO=true install"),
	};

	let output = std.autotools.build({
		...std.triple.rotate({ build, host }),
		env,
		opt: "3",
		phases,
		sdk,
		source: source_ ?? source(build),
	});

	return output;
});

export default build;

export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdkArg = await bootstrap.sdk.arg(host);

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
		sdk: sdkArg,
	});
	return true;
});
