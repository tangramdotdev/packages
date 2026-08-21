import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://people.redhat.com/sgrubb/libcap-ng/",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-2.0-or-later, LGPL-2.1-or-later",
	name: "libcap-ng",
	repository: "https://github.com/stevegrubb/libcap-ng",
	version: "0.8.5",
	tag: "libcap-ng/0.8.5",
	provides: {
		binaries: ["captest", "filecap", "netcap", "pscap"],
		libraries: ["cap-ng"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:3ba5294d1cbdfa98afaacfbc00b6af9ed2b83e8a21817185dfd844cc8c7ac6ff";
	return std
		.download({
			url: `https://people.redhat.com/sgrubb/libcap-ng/${name}-${version}.tar.gz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export type Arg = std.autotools.Arg;

export async function build(...args: tg.Args<Arg>) {
	// The python bindings need swig and a python development install, and nothing links against them here.
	const arg = await std.autotools.arg(
		{
			source: source(),
			phases: {
				configure: {
					args: ["--disable-dependency-tracking", "--without-python3"],
				},
			},
		},
		...args,
	);
	std.assert.supportedHost(arg.host, metadata);
	return std.autotools.build(arg);
}

export default build;

export async function test() {
	const spec = {
		...std.assert.defaultSpec(metadata),
		// None of the tools report a version; `pscap` prints its usage on an unknown flag.
		binaries: std.assert.allBinaries(metadata.provides.binaries, {
			testArgs: ["--help"],
			snapshot: "usage",
			exitOnErr: false,
		}),
	};
	return await std.assert.pkg(build, spec);
}
