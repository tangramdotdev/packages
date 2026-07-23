import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "http://gondor.apana.org.au/~herbert/dash/",
	license: "BSD-3-Clause",
	name: "dash",
	repository: "https://git.kernel.org/pub/scm/utils/dash/dash.git",
	version: "0.5.13.5",
	tag: "dash/0.5.13.5",
	provides: {
		binaries: ["dash"],
	},
};

export async function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:40090101a2a491f13e901d3d48e90414f26634628b9bfff35ff540363c227a7d";
	const url = `http://gondor.apana.org.au/~herbert/dash/files/${name}-${version}.tar.gz`;
	return std.download
		.extractArchive({ url, checksum })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export type Arg = std.autotools.Arg;

export function build(...args: std.Args<Arg>) {
	return std.autotools.build(
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
}

export default build;

export async function test() {
	return await std.assert.pkg(build, {
		binaries: [
			{
				name: "dash",
				testArgs: ["-c", "'echo hello'"],
				snapshot: "hello",
			},
		],
	});
}
