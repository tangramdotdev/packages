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

	return std.download.fromGnu({
		name,
		version,
		compressionFormat: "xz",
		checksum,
	});
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
	target?: string;
};

/** Obtain the GNU binutils. */
export let build = tg.target(async (arg?: Arg) => {
	let {
		autotools = {},
		build: build_,
		env,
		host: host_,
		sdk,
		source: source_,
		target: target_,
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;
	let target = target_ ?? host;

	// Collect configuration.
	let configure = {
		args: [
			`--with-sysroot=$OUTPUT`,
			"--disable-dependency-tracking",
			"--disable-nls",
			"--disable-werror",
			"--enable-deterministic-archives",
			"--enable-gprofng=no",
			`--build=${build}`,
			`--host=${host}`,
			`--target=${target}`,
		],
	};

	// NOTE: We could pull in `dependencies.texinfo` to avoid needing to set `MAKEINFO=true`, but we do not need the docs here and texinfo transitively adds more rebuilds than the other required dependencies, which would increase the total build time needlessly.
	let makeinfoOverride = {
		args: ["MAKEINFO=true"],
	};

	let phases = {
		configure,
		build: makeinfoOverride,
		install: makeinfoOverride,
	};

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			opt: "3",
			phases,
			sdk,
			source: source_ ?? source(build),
		},
		autotools,
	);
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
