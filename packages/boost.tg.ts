import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.boost.org/",
	license: "BSL-1.0",
	name: "boost",
	repository: "https://github.com/boostorg/boost",
	version: "1.87.0",
	tag: "boost/1.87.0",
};

export const source = async () => {
	const { version } = metadata;
	const underscoreVersion = version.replace(/\./g, "_");
	const checksum =
		"sha256:f55c340aa49763b1925ccf02b2e83f35fdcf634c9d5164a2acb87540173c741d";
	const base = `https://archives.boost.io/release/${version}/source`;
	const name = `boost_${underscoreVersion}`;
	const extension = ".tar.gz";
	return std.download
		.extractArchive({ base, checksum, name, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = std.autotools.Arg & {
	/** Which compiled Boost libraries to build. Omit to build all. Header-only libraries are always available. */
	libraries?: Array<string>;
};

export const build = async (...args: std.Args<Arg>) => {
	// Extract custom options.
	const resolved = await std.args.apply<Arg, Arg>({
		args: args as std.Args<Arg>,
		map: async (arg) => arg,
		reduce: {},
	});
	const libraries = resolved.libraries as Array<string> | undefined;

	const arg = await std.autotools.arg(
		{ source: source(), buildInTree: true, defaultCrossArgs: false },
		...args,
	);

	// If specific libraries requested, pass --with-libraries to bootstrap.sh.
	const librariesFlag = libraries?.length
		? ` --with-libraries=${libraries.join(",")}`
		: "";

	const phases = std.phases.arg(arg.phases, {
		configure: tg`./bootstrap.sh --prefix=${tg.output}${librariesFlag}`,
		build: `./b2 -j$(nproc) variant=release link=shared,static threading=multi`,
		install: tg`./b2 install --prefix=${tg.output}`,
	});

	return std.autotools.build({ ...arg, phases });
};

export default build;

export const test = async () => {
	const spec: std.assert.PackageSpec = {
		headers: ["boost/version.hpp"],
		libraries: [{ name: "boost_system", dylib: true, staticlib: true }],
	};
	return await std.assert.pkg(build, spec);
};
