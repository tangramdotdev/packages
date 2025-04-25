import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.fftw.org/",
	license: "GPL-2.0-or-later",
	name: "fftw",
	repository: "https://github.com/FFTW/fftw3",
	version: "3.3.10",
	provides: {
		// FIXME cat not found for fftw-wisdom-to-conf
		binaries: ["fftw-wisdom", "fftw-wisdom-to-conf"],
		libraries: ["fftw3"],
	},
};

export const source = tg.command(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:56c932549852cddcfafdab3820b0200c7742675be92179e59e6215b340e26467";
	const extension = ".tar.gz";
	const base = `https://fftw.org/pub/${name}`;
	return await std.download
		.extractArchive({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.command(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const os = std.triple.os(host);

	const configure = {
		args: [
			"--disable-dependency-tracking",
			"--enable-shared",
			"--enable-static",
			"--enable-threads",
		],
	};
	if (os === "linux") {
		configure.args.push("--enable-openmp");
	}

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(env),
			phases: { configure },
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

export const test = tg.command(async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
});
