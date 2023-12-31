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

	let patch = tg.File.expect(await tg.include("musl_permission.patch"));
	source = await std.patch(source, patch);

	return source;
});

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	// buildToolchain: tg.Directory;
	// /* Optionally only build the C startup files and headers. */
	// csuOnly?: boolean;
	/* Optionally point to a specific implementation of libcc. */
	libcc?: tg.File;
	source?: tg.Directory;
	target?: std.Triple.Arg;
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
	let host = host_ ? std.triple(host_) : await std.Triple.host();
	let build = build_ ? std.triple(build_) : host;
	let target = target_ ? std.triple(target_) : host;
	let hostTriple = std.triple(target ?? host);
	let hostString = std.Triple.toString(hostTriple);

	// NOTE - for musl and other libcs, `host` is the system this libc will produce binaries for.
	// For cross-compilers, this will be distinct from `build`, which is the system the compiler is built on.

	let isCrossCompiling = !std.Triple.eq(hostTriple, host);

	let commonFlags = [`--enable-debug`, `--enable-optimize`];

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
		args: [
			// This is because we plan to put it in a sysroot.
			...commonFlags,
			...additionalFlags,
		],
	};

	let install = tg`make DESTDIR="$OUTPUT/${hostString}" install`;

	let phases = {
		configure,
		install,
	};

	let env = [
		dependencies.env({ host: build, sdk: rest.sdk }),
		{ CPATH: tg.Mutation.unset() },
		env_,
	];

	let result = await std.autotools.build(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
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

export let interpreterPath = (triple: std.Triple.Arg) =>
	`lib/${interpreterName(triple)}`;

export let interpreterName = (triple: std.Triple.Arg) => {
	let arch = std.triple(triple).arch;
	return `ld-musl-${arch}.so.1`;
};

export let linkerPath = (system: std.Triple.Arg) => {
	let triple = std.triple(system);
	triple.environment = "musl";
	let tripleString = std.Triple.toString(triple);
	return `${tripleString}/bin/ld`;
};
