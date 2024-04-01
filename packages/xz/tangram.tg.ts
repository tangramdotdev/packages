import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://tukaani.org/xz/",
	name: "xz",
	version: "5.4.6",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let unpackFormat = ".tar.gz" as const;
	let checksum =
		"sha256:aeba3e03bf8140ddedf62a0a367158340520f6b384f75ca6045ccc6c0d43fd5c";
	let url = `https://downloads.sourceforge.net/project/lzmautils/${name}-${version}${unpackFormat}`;
	let outer = tg.Directory.expect(
		await std.download({
			url,
			checksum,
			unpackFormat,
		}),
	);
	return std.directory.unwrap(outer);
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let xz = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let configure = {
		args: [
			"--disable-debug",
			"--disable-dependency-tracking",
			"--disable-nls",
			"--disable-silent-rules",
		],
	};

	let output = await std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			phases: { configure },
			source: source_ ?? source(),
		},
		autotools,
	);

	// Wrap binaries that need the library path set.
	let bins = ["lzmadec", "lzmainfo", "xz", "xzdec"];
	let libDir = tg.Directory.expect(await output.get("lib"));
	for (let bin of bins) {
		let unwrappedBin = tg.File.expect(await output.get(`bin/${bin}`));
		let wrappedBin = std.wrap(unwrappedBin, {
			libraryPaths: [libDir],
		});
		output = await tg.directory(output, { [`bin/${bin}`]: wrappedBin });
	}

	return output;
});

export default xz;

export let test = tg.target(async () => {
	let xzArtifact = xz();
	await std.assert.pkg({
		directory: xzArtifact,
		binaries: [
			"lzmadec",
			"lzmainfo",
			"xz",
			"xzdec",
			"xzdiff",
			"xzgrep",
			"xzless",
			"xzmore",
		],
		libs: ["lzma"],
		metadata,
	});
	return xzArtifact;
});
