import * as std from "std" with { path: "../std" };
import coreutils from "coreutils" with { path: "../coreutils" };

export const metadata = {
	homepage: "https://www.fftw.org/",
	license: "GPL-2.0-or-later",
	name: "fftw",
	repository: "https://github.com/FFTW/fftw3",
	version: "3.3.10",
	provides: {
		binaries: ["fftw-wisdom", "fftw-wisdom-to-conf"],
		libraries: ["fftw3"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:56c932549852cddcfafdab3820b0200c7742675be92179e59e6215b340e26467";
	const extension = ".tar.gz";
	const base = `https://fftw.org/pub/${name}`;
	return await std.download
		.extractArchive({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

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

	let output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases: { configure },
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	// fftw-wisdom-to-conf expects coreutils like `cat` available in the env.
	const coreutilsArtifact = coreutils({ host });
	const unwrapped = await output
		.get("bin/fftw-wisdom-to-conf")
		.then(tg.File.expect);
	const wrapped = await std.wrap(unwrapped, {
		env: std.env.arg(coreutilsArtifact),
	});
	output = await tg.directory(output, { ["bin/fftw-wisdom-to-conf"]: wrapped });

	return output;
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
