import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import * as dependencies from "./dependencies.tg.ts";

export let metadata = {
	name: "binutils",
	version: "2.41",
};

export let source = tg.target(async (build: std.Triple.Arg) => {
	let { name, version } = metadata;

	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:ae9a5789e23459e59606e6714723f2d3ffc31c03174191ef0d015bdf06007450";

	let unpatchedSource = std.download.fromGnu({
		name,
		version,
		compressionFormat,
		checksum,
	});

	let utils = bootstrap.utils({ host: build });

	// Work around an issue regarding libtool and sysroots. See: https://www.linuxfromscratch.org/lfs/view/stable/chapter06/binutils-pass2.html
	let script = tg`
		mkdir -p $OUTPUT
		cp -R ${unpatchedSource}/* $OUTPUT
		chmod -R u+w $OUTPUT
		cd $OUTPUT
		sed '6009s/$add_dir//' -i ltmain.sh
	`;
	let result = tg.Directory.expect(
		await tg.build(script, { env: std.env.object(utils) }),
	);
	return result;
});

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
	staticBuild?: boolean;
	target?: std.Triple.Arg;
};

/** Obtain the GNU binutils. */
export let build = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		staticBuild,
		target: target_,
		...rest
	} = arg ?? {};
	let host = host_ ? std.triple(host_) : await std.Triple.host();
	let build = build_ ? std.triple(build_) : host;
	let target = target_ ? std.triple(target_) : host;

	let buildString = std.Triple.toString(build);
	let hostString = std.Triple.toString(host);
	let targetString = std.Triple.toString(target);
	let buildPhase = arg?.staticBuild
		? `make && make clean && make LDFLAGS=-all-static`
		: undefined;

	let additionalEnv: std.env.Arg = {};
	if (staticBuild) {
		additionalEnv = {
			...additionalEnv,
			CC: await tg`${targetString}-cc -static -fPIC`,
			CXX: await tg`${targetString}-c++ -static-libstdc++ -fPIC`,
		};
	}
	let env = [
		dependencies.env({ host: build, sdk: rest.sdk }),
		additionalEnv,
		env_,
	];

	// Collect configuration.
	let configure = {
		args: [
			`--with-sysroot=$OUTPUT`,
			"--disable-dependency-tracking",
			"--disable-nls",
			"--disable-werror",
			"--enable-gprofng=no",
			`--build=${buildString}`,
			`--host=${hostString}`,
			`--target=${targetString}`,
		],
	};

	let phases = {
		prepare: "set +x",
		configure,
		build: buildPhase,
	};

	let output = std.autotools.build(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			env,
			// parallel: false,
			phases,
			source: source_ ?? source(build),
		},
		autotools,
	);

	return output;
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		directory: build({ sdk: { bootstrapMode: true } }),
		binaries: ["ar", "as", "ld", "nm", "objcopy", "objdump", "ranlib", "strip"],
		metadata,
	});
	return true;
});
