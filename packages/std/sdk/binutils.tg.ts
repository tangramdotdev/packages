import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import * as dependencies from "./dependencies.tg.ts";

export let metadata = {
	name: "binutils",
	version: "2.42",
};

export let source = tg.target(async (build: tg.Triple.Arg) => {
	let { name, version } = metadata;

	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:f6e4d41fd5fc778b06b7891457b3620da5ecea1006c6a4a41ae998109f85a800";

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
	target?: tg.Triple.Arg;
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
	let host = host_ ? tg.triple(host_) : await tg.Triple.host();
	let build = build_ ? tg.triple(build_) : host;
	let target = target_ ? tg.triple(target_) : host;

	let buildString = tg.Triple.toString(build);
	let hostString = tg.Triple.toString(host);
	let targetString = tg.Triple.toString(target);
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
	let env: tg.Unresolved<Array<std.env.Arg>> = [];
	if (rest.bootstrapMode) {
		env.push(
			dependencies.env({
				...rest,
				env: std.sdk({ host: build, bootstrapMode: true }),
				host: build,
			}),
		);
	}
	env = env.concat([additionalEnv, env_]);

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
			...tg.Triple.rotate({ build, host }),
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
