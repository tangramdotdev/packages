import * as std from "../../tangram.ts";

export const metadata = {
	homepage: "https://libisl.sourceforge.io",
	name: "isl",
	version: "0.27",
	tag: "isl/0.27",
};

export const source = async () => {
	const { homepage, name, version } = metadata;
	const extension = ".tar.xz";
	const checksum =
		"sha256:6d8babb59e7b672e8cb7870e874f3f7b813b6e00e6af3f8b04f7579965643d5c";
	return await std.download
		.extractArchive({ checksum, base: homepage, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = std.autotools.Arg;

export const build = async (...args: std.Args<Arg>) => {
	return std.autotools.build(
		{
			source: source(),
			phases: {
				configure: {
					args: ["--disable-dependency-tracking"],
				},
			},
			// We need GMP to be available during the build.
			setRuntimeLibraryPath: true,
		},
		...args,
	);
};

export default build;

export const test = async () => {
	return await build();
};
