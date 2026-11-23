import * as libmnl from "libmnl" with { source: "./libmnl.tg.ts" };
import * as libnftnl from "libnftnl" with { source: "./libnftnl.tg.ts" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	builds: {
		exports: ["default", "build"],
		hosts: ["aarch64-linux", "x86_64-linux"],
	},
	homepage: "https://www.netfilter.org/projects/iptables/",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-2.0-or-later",
	name: "iptables",
	repository: "https://git.netfilter.org/iptables/",
	version: "1.8.13",
	tag: "iptables/1.8.13",
	provides: {
		binaries: [
			"ip6tables",
			"ip6tables-nft",
			"iptables",
			"iptables-nft",
			"iptables-nft-restore",
			"iptables-restore",
		],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:1afcd33da9e8f913ace6a2126788162e207e26f5d5e29c6573c0e581ffc58b99";
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
		libnftnl: libnftnl.build,
	});
}

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export async function build(...args: tg.Args<Arg>) {
	// Link the match and target extensions into the executables, because a shared build loads them at run time from a directory fixed at build time. Install the executables in `bin`, not `sbin`.
	const arg = await std.autotools.arg(
		{
			deps,
			source: source(),
			phases: {
				configure: {
					args: [
						"--disable-connlabel",
						"--disable-libnfnetlink",
						"--disable-shared",
						"--enable-static",
						tg`--sbindir=${tg.output}/bin`,
					],
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
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
