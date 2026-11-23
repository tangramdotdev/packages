import * as std from "std" with { source: "./std" };

export const metadata = {
	builds: {
		exports: ["default", "build"],
		hosts: ["aarch64-linux", "x86_64-linux"],
	},
	homepage: "https://www.netfilter.org/projects/libmnl/",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "LGPL-2.1-or-later",
	name: "libmnl",
	repository: "https://git.netfilter.org/libmnl/",
	version: "1.0.5",
	tag: "libmnl/1.0.5",
	provides: {
		libraries: ["mnl"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:274b9b919ef3152bfb3da3a13c950dd60d6e2bcd54230ffeca298d03b40d0525";
	return std
		.download({
			url: `https://www.netfilter.org/pub/${name}/${name}-${version}.tar.bz2`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export type Arg = std.autotools.Arg;

export async function build(...args: tg.Args<Arg>) {
	const arg = await std.autotools.arg(
		{
			source: source(),
			phases: { configure: { args: ["--enable-static"] } },
		},
		...args,
	);
	std.assert.supportedHost(arg.host, metadata);
	return std.autotools.build(arg);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
