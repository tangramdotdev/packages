import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "bzip2",
	version: "1.0.8",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:ab5a03176ee106d3f0fa90e381da478ddae405918153cca248e682cd0c4a2269";
	let unpackFormat = ".tar.gz" as const;
	let url = `https://sourceware.org/pub/${name}/${name}-${version}${unpackFormat}`;
	let artifact = tg.Directory.expect(
		await std.download({
			checksum,
			unpackFormat,
			url,
		}),
	);

	return std.directory.unwrap(artifact);
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: tg.Triple.Arg;
	env?: std.env.Arg;
	host?: tg.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let bzip2 = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = await tg.Triple.host(host_);

	let os = tg.Triple.os(tg.Triple.archAndOs(host));
	let sharedObjectExt = os === "darwin" ? "dylib" : "so";

	let sourceDir = source_ ?? source();

	let prepare = tg`set -x && cp -R ${sourceDir}/* .`;
	let configure = "sed -i 's@\\(ln -s -f \\)$(PREFIX)/bin/@\\1@' Makefile";

	// Only build the shared library on Linux.
	let buildCommand =
		os === "linux"
			? `make -f Makefile-libbz2_so && make clean && make`
			: `make CC="cc \${CFLAGS}"`;

	let fixup =
		os === "linux"
			? `
				cp -av libbz2.${sharedObjectExt}* $OUTPUT/lib
				chmod -R u+w $OUTPUT
				cd $OUTPUT/lib
				ln -sv libbz2.${sharedObjectExt}.${metadata.version} libbz2.${sharedObjectExt}
			`
			: "";

	let phases = {
		prepare,
		build: buildCommand,
		configure,
		install: `make install PREFIX="$OUTPUT"`,
		fixup,
	};

	return std.autotools.build(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			source: sourceDir,
			prefixArg: undefined,
			phases,
		},
		autotools,
	);
});

export default bzip2;

export let test = tg.target(async () => {
	await std.assert.pkg({
		directory: await bzip2(),
		binaries: [{ name: "bzip2", testArgs: ["--help"] }],
		libs: [{ name: "bz2", dylib: false, staticlib: true }],
		metadata,
	});
	return true;
});
