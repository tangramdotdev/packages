import * as libmnl from "libmnl" with { source: "./libmnl.tg.ts" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	builds: {
		exports: ["default", "build"],
		hosts: ["aarch64-linux", "x86_64-linux"],
	},
	homepage: "https://www.netfilter.org/projects/libnftnl/",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-2.0-or-later",
	name: "libnftnl",
	repository: "https://git.netfilter.org/libnftnl/",
	version: "1.3.2",
	tag: "libnftnl/1.3.2",
	provides: {
		libraries: ["nftnl"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:c97abc3409f8fa396b4462b2bb7f147a3a47a4ddc97cfa0b2f18890c9cfde8b0";
	return std
		.download({
			url: `https://www.netfilter.org/pub/${name}/${name}-${version}.tar.xz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export function deps() {
	return std.deps({
		libmnl: libmnl.build,
	});
}

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export async function build(...args: tg.Args<Arg>) {
	const arg = await std.autotools.arg(
		{
			deps,
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
	const spec: std.assert.PackageSpec = {
		...std.assert.defaultSpec(metadata),
		libraries: std.assert.allLibraries(["nftnl"], {
			runtimeDeps: [libmnl.build()],
		}),
	};
	return await std.assert.pkg(build, spec);
}
