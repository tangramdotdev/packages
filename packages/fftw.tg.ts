import * as std from "std" with { local: "./std" };
import coreutils from "coreutils" with { local: "./coreutils.tg.ts" };

export const metadata = {
	homepage: "https://www.fftw.org/",
	license: "GPL-2.0-or-later",
	name: "fftw",
	repository: "https://github.com/FFTW/fftw3",
	version: "3.3.10",
	tag: "fftw/3.3.10",
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

export type Arg = std.autotools.Arg;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg({ source: source() }, ...args);

	// Configure args based on OS.
	const os = std.triple.os(arg.host);
	const configureArgs = [
		"--disable-dependency-tracking",
		"--enable-shared",
		"--enable-static",
		"--enable-threads",
	];
	if (os === "linux") {
		configureArgs.push("--enable-openmp");
	}

	const output = await std.autotools.build({
		...arg,
		phases: { configure: { args: configureArgs } },
	});

	// fftw-wisdom-to-conf expects coreutils like `cat` available in the env.
	const coreutilsArtifact = coreutils({ host: arg.host });
	const unwrapped = await output
		.get("bin/fftw-wisdom-to-conf")
		.then(tg.File.expect);
	const wrapped = await std.wrap(unwrapped, {
		env: std.env.arg(coreutilsArtifact),
	});
	return tg.directory(output, { ["bin/fftw-wisdom-to-conf"]: wrapped });
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
