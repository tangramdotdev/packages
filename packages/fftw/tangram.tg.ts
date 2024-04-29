import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://www.fftw.org/",
	license: "GPL-2.0-or-later",
	name: "fftw",
	repository: "https://github.com/FFTW/fftw3",
	version: "3.3.10",
};

export let source = tg.target(async (): Promise<tg.Directory> => {
	let { name, version } = metadata;
	let checksum =
		"sha256:56c932549852cddcfafdab3820b0200c7742675be92179e59e6215b340e26467";
	let packageArchive = std.download.packageArchive({
		name,
		version,
		extension: ".tar.gz",
	});
	let url = `https://fftw.org/pub/${name}/${packageArchive}`;
	let outer = tg.Directory.expect(
		await std.download({
			checksum,
			url,
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

export let fftw = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let configure = {
		args: [
			"--disable-dependency-tracking",
			"--enable-openmp",
			"--enable-shared",
			"--enable-static",
			"--enable-threads",
		],
	};

	let env = [{ TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: "filter" }, env_];

	let output = await std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases: { configure },
			source: source_ ?? source(),
		},
		autotools,
	);

	// Wrap output binaries.
	let libDir = tg.Directory.expect(await output.get("lib"));
	let binDir = tg.Directory.expect(await output.get("bin"));
	for await (let [name, artifact] of binDir) {
		let file = tg.File.expect(artifact);
		let wrappedBin = await std.wrap(file, { libraryPaths: [libDir] });
		output = await tg.directory(output, { [`bin/${name}`]: wrappedBin });
	}

	return output;
});

export default fftw;

export let test = tg.target(async () => {
	let artifact = fftw();
	await std.assert.pkg({
		buildFunction: fftw,
		binaries: ["fftw-wisdom", "fftw-wisdom-to-conf"],
		libraries: ["fftw3"],
	});
	return artifact;
});
