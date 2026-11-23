import * as libmnl from "libmnl" with { source: "./libmnl.tg.ts" };
import * as libnftnl from "libnftnl" with { source: "./libnftnl.tg.ts" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	builds: {
		exports: ["default", "build"],
		hosts: ["aarch64-linux", "x86_64-linux"],
	},
	homepage: "https://www.netfilter.org/projects/nftables/",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-2.0-or-later",
	name: "nftables",
	repository: "https://git.netfilter.org/nftables/",
	version: "1.1.7",
	tag: "nftables/1.1.7",
	provides: {
		binaries: ["nft"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:a6fbf060d8d4fff001517a2b94f356bb4366bfbf0ba366366f9d27cc38caa58f";
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
	// Use the bundled mini-gmp and leave out the interactive shell, the JSON output, and the manual pages, so that the only dependencies are the netlink libraries. Link libnftables into the executable statically, so that the executable names the netlink libraries itself, and install it in `bin`, not `sbin`.
	const arg = await std.autotools.arg(
		{
			deps,
			source: source(),
			phases: {
				configure: {
					args: [
						"--disable-man-doc",
						"--disable-shared",
						"--enable-static",
						"--with-mini-gmp",
						"--without-cli",
						"--without-json",
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
