import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "attr",
	version: "2.5.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let extension = ".tar.xz";
	let packageArchive = std.download.packageArchive({
		extension,
		name,
		version,
	});
	let checksum =
		"sha256:f2e97b0ab7ce293681ab701915766190d607a1dba7fae8a718138150b700a70b";
	let url = `https://mirrors.sarata.com/non-gnu/attr/${packageArchive}`;
	return await std
		.download({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let attr = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let configure = {
		args: ["--disable-dependency-tracking", "--disable-rpath", "--with-pic"],
	};
	let phases = { configure };

	let output = await std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			phases,
			sdk,
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

	// Remove .la files.
	for await (let [name, _] of libDir) {
		if (name.endsWith(".la")) {
			output = await tg.directory(output, { [`lib/${name}`]: undefined });
		}
	}

	return output;
});

export default attr;

export let test = tg.target(async () => {
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
		buildFunction: attr,
		libraries: ["attr"],
		metadata,
	});
	return true;
});
