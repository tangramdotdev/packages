import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://gitlab.com/procps-ng/procps",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-2.0-or-later, LGPL-2.1-or-later",
	name: "procps-ng",
	repository: "https://gitlab.com/procps-ng/procps",
	version: "4.0.7",
	tag: "procps/4.0.7",
	provides: {
		binaries: ["pgrep", "pkill", "ps"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:9d2021f47a4501c667862c9942a92d1953694b21d11bcd1702e83eb594e3d67d";
	return std
		.download({
			url: `https://downloads.sourceforge.net/project/procps-ng/Production/${name}-${version}.tar.xz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export type Arg = std.autotools.Arg;

export async function build(...args: tg.Args<Arg>) {
	// `top`, `watch`, and `slabtop` are the only programs that need ncurses, and
	// none of them is worth the dependency here. Translations need gettext at
	// build time and contribute nothing to a machine-read `ps`.
	const arg = await std.autotools.arg(
		{
			source: source(),
			phases: {
				configure: {
					args: ["--disable-nls", "--without-ncurses"],
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
