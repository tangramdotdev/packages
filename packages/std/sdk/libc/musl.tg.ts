import * as std from "../../tangram.tg.ts";
import * as dependencies from "../dependencies.tg.ts";

export let metadata = {
	name: "musl",
	version: "1.2.4",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let unpackFormat = ".tar.gz" as const;
	let packageArchive = std.download.packageArchive({
		name,
		version,
		unpackFormat,
	});
	let checksum =
		"sha256:7a35eae33d5372a7c0da1188de798726f68825513b7ae3ebe97aaaa52114f039";
	let url = `https://musl.libc.org/releases/${packageArchive}`;
	let source = tg.Directory.expect(
		await std.download({ url, checksum, unpackFormat }),
	);
	source = await std.directory.unwrap(source);

	let patch = tg.File.expect(await tg.include("musl_permission.patch"));
	source = await std.patch(source, patch);

	return source;
});

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	/* Optionally point to a specific implementation of libcc. */
	libcc?: tg.File;
	source?: tg.Directory;
	target?: tg.Triple.Arg;
};

export default tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		libcc = false,
		source: source_,
		target: target_,
		...rest
	} = arg ?? {};
	let host = host_ ? tg.triple(host_) : await tg.Triple.host();
	let build = build_ ? tg.triple(build_) : host;
	let target = target_ ? tg.triple(target_) : host;
	let hostTriple = tg.triple(target ?? host);
	let buildString = tg.Triple.toString(build);
	let hostString = tg.Triple.toString(hostTriple);

	// NOTE - for musl and other libcs, `host` is the system this libc will produce binaries for.
	// For cross-compilers, this will be distinct from `build`, which is the system the compiler is built on.

	let isCrossCompiling = !tg.Triple.eq(hostTriple, host);

	let commonFlags = [
		`--enable-debug`,
		`--enable-optimize=*`,
		`--build=${buildString}`,
		`--host=${hostString}`,
	];

	let additionalFlags: Array<string | tg.Template> = isCrossCompiling
		? [
				`CROSS_COMPILE="${hostString}-"`,
				`CC="${hostString}-gcc"`,
				"--disable-gcc-wrapper",
			]
		: [];

	if (libcc) {
		additionalFlags.push(await tg`LIBCC="${arg?.libcc}"`);
	}

	let configure = {
		args: [...commonFlags, ...additionalFlags],
	};

	let install = {
		args: [`DESTDIR="$OUTPUT/${hostString}"`],
	};

	let phases = {
		configure,
		install,
	};

	let env: tg.Unresolved<Array<std.env.Arg>> = [env_];
	if (rest.bootstrapMode) {
		env.push(
			dependencies.env({
				...rest,
				env: std.sdk({ host: build, bootstrapMode: rest.bootstrapMode }),
				host: build,
			}),
		);
	}
	env = env.concat([{ CPATH: tg.Mutation.unset() }]);

	let result = await std.autotools.build(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			env,
			phases,
			prefixPath: "/", // It's going in a sysroot.
			source: source_ ?? source(),
		},
		autotools,
	);

	// Add an ld.so file, which in musl is just a symlink to libc.so.
	result = await tg.directory(result, {
		[`${interpreterPath(host)}`]: tg.symlink("libc.so"),
	});

	return result;
});

export let interpreterPath = (triple: tg.Triple.Arg) => {
	let triple_ = tg.triple(triple);
	let tripleString = tg.Triple.toString(triple_);
	return `${tripleString}/lib/${interpreterName(triple_)}`;
};

export let interpreterName = (triple: tg.Triple.Arg) => {
	let arch = tg.triple(triple).arch;
	return `ld-musl-${arch}.so.1`;
};

export let linkerPath = (system: tg.Triple.Arg) => {
	let triple = tg.triple(system);
	triple.environment = "musl";
	let tripleString = tg.Triple.toString(triple);
	return `${tripleString}/bin/ld`;
};
