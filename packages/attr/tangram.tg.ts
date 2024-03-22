import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "attr",
	version: "2.5.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let unpackFormat = ".tar.xz" as const;
	let packageArchive = std.download.packageArchive({
		name,
		version,
		unpackFormat,
	});
	let checksum =
		"sha256:f2e97b0ab7ce293681ab701915766190d607a1dba7fae8a718138150b700a70b";
	let url = `https://mirrors.sarata.com/non-gnu/attr/${packageArchive}`;
	let outer = tg.Directory.expect(
		await std.download({ url, checksum, unpackFormat }),
	);
	return await std.directory.unwrap(outer);
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let attr = tg.target(async (arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	let configure = {
		args: ["--disable-dependency-tracking", "--disable-rpath", "--with-pic"],
	};
	let phases = { configure };

	let output = await std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);

	let libDir = tg.Directory.expect(await output.get("lib"));
	let bins = await Promise.all(
		["attr", "getfattr", "setfattr"].map(async (bin) => {
			return [
				bin,
				std.wrap(tg.File.expect(await output.get(`bin/${bin}`)), {
					libraryPaths: [libDir],
				}),
			];
		}),
	);
	for (let [binName, binFile] of bins) {
		output = await tg.directory(output, { [`bin/${binName}`]: binFile });
	}
	return output;
});

export default attr;

export let test = tg.target(async () => {
	let directory = attr();
	let binTest = (name: string) => {
		return {
			name,
			testArgs: [],
			testPredicate: (stdout: string) => stdout.includes("Usage:"),
		};
	};
	let binaries = ["attr", "getfattr", "setfattr"].map(binTest);

	await std.assert.pkg({
		binaries,
		directory,
		libs: ["attr"],
		metadata,
	});
	return directory;
});
