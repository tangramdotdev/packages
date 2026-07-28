import * as std from "../../tangram.ts";

export const metadata = {
	homepage: "https://libisl.sourceforge.io",
	name: "isl",
	version: "0.28",
	tag: "isl/0.28",
};

export async function source() {
	const { homepage, name, version } = metadata;
	const extension = ".tar.xz";
	const checksum =
		"sha256:3dc31b8e1b18329e42d5dfbf84dd55e15c59b61569a2ab246f61497d9592f727";
	return await std.download
		.extractArchive({ checksum, base: homepage, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export type Arg = std.autotools.Arg;

export async function build(...args: tg.Args<Arg>) {
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
}

export default build;

export async function test() {
	return await build();
}
