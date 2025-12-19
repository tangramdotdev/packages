import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "http://gondor.apana.org.au/~herbert/dash/",
	license: "BSD-3-Clause",
	name: "dash",
	repository: "https://git.kernel.org/pub/scm/utils/dash/dash.git",
	version: "0.5.13",
	provides: {
		binaries: ["dash"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:fd8da121e306b27f59330613417b182b8844f11e269531cc4720bf523e3e06d7";
	const url = `http://gondor.apana.org.au/~herbert/dash/files/${name}-${version}.tar.gz`;
	return std.download
		.extractArchive({ url, checksum })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = std.autotools.Arg;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		{
			source: source(),
			phases: {
				configure: {
					args: [
						"--disable-dependency-tracking",
						"--enable-fnmatch",
						"--enable-glob",
					],
				},
			},
		},
		...args,
	);

export default build;

export const test = async () => {
	return await std.assert.pkg(build, {
		binaries: [
			{
				name: "dash",
				testArgs: ["-c", "'echo hello'"],
				snapshot: "hello",
			},
		],
	});
};
