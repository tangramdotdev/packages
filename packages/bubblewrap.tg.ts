import * as libcap from "libcap" with { source: "./libcap.tg.ts" };
import * as meson from "meson" with { source: "./meson.tg.ts" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://github.com/containers/bubblewrap",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "LGPL-2.0-or-later",
	name: "bubblewrap",
	repository: "https://github.com/containers/bubblewrap",
	version: "0.13.1",
	tag: "bubblewrap/0.13.1",
	provides: {
		binaries: ["bwrap"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:0e85c8702248b8dd64144f594147553650cdd0e4c951690345faace79c217c4d";
	return std
		.download({
			url: `https://github.com/containers/${name}/releases/download/v${version}/${name}-${version}.tar.xz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export function deps() {
	return std.deps({
		libcap: libcap.build,
	});
}

export type Arg = meson.BuildArg;

export async function build(...args: tg.Args<Arg>) {
	// The man pages need xsltproc, and SELinux support needs libselinux.
	const resolved = await meson.arg(
		{
			source: source(),
			deps,
			phases: {
				configure: {
					args: ["-Dman=disabled", "-Dselinux=disabled", "-Dtests=false"],
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
