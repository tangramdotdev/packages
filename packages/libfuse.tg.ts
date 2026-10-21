import * as meson from "meson" with { source: "./meson.tg.ts" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://github.com/libfuse/libfuse",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-2.0-only, LGPL-2.1-only",
	name: "libfuse",
	repository: "https://github.com/libfuse/libfuse",
	version: "3.18.3",
	tag: "libfuse/3.18.3",
	provides: {
		binaries: ["fusermount3"],
		libraries: [{ name: "fuse3", dylib: true, staticlib: false }],
	},
};

export function source() {
	const { version } = metadata;
	const checksum =
		"sha256:bcd19582c5e30f7fe45dd86a5540e998590aa01903afc7ebcbeea6c8ac5421ee";
	return std
		.download({
			url: `https://github.com/libfuse/libfuse/releases/download/fuse-${version}/fuse-${version}.tar.gz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export type Arg = meson.BuildArg;

export async function build(...args: tg.Args<Arg>) {
	// The installation cannot chown or setuid fusermount3, init scripts belong to the host, and fuse-over-io-uring needs liburing and libnuma.
	const resolved = await meson.arg(
		{
			source: source(),
			phases: {
				configure: {
					args: [
						"-Denable-io-uring=false",
						"-Dexamples=false",
						"-Dinitscriptdir=",
						"-Dtests=false",
						"-Duseroot=false",
					],
				},
			},
		},
		...args,
	);
	std.assert.supportedHost(resolved.host, metadata);
	return await meson.build(resolved);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
