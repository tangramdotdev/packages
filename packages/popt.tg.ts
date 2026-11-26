import * as std from "std" with { source: "./std" };

export const metadata = {
	builds: { exports: ["default", "build"] },
	homepage: "https://github.com/rpm-software-management/popt",
	license: "MIT",
	name: "popt",
	repository: "https://github.com/rpm-software-management/popt",
	version: "1.19",
	tag: "popt/1.19",
	provides: {
		headers: ["popt.h"],
		libraries: ["popt"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:c25a4838fc8e4c1c8aacb8bd620edb3084a3d63bf8987fdad3ca2758c63240f9";
	return std
		.download({
			url: `https://ftp.osuosl.org/pub/rpm/${name}/releases/${name}-1.x/${name}-${version}.tar.gz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export type Arg = std.autotools.Arg;

export function build(...args: tg.Args<Arg>) {
	return std.autotools.build(
		{
			source: source(),
			phases: {
				configure: {
					args: [
						"--disable-dependency-tracking",
						"--disable-nls",
						"--enable-static",
					],
				},
			},
		},
		...args,
	);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
