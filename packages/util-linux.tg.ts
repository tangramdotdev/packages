import * as bash from "bash" with { source: "./bash.tg.ts" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://github.com/util-linux/util-linux",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-2.0-or-later, LGPL-2.1-or-later, BSD-3-Clause",
	name: "util-linux",
	repository: "https://github.com/util-linux/util-linux",
	version: "2.42.4",
	tag: "util-linux/2.42.4",
	provides: {
		binaries: [
			"findmnt",
			"flock",
			"getopt",
			"kill",
			"lsblk",
			"mount",
			"nsenter",
			"setsid",
			"umount",
			"unshare",
		],
		libraries: ["blkid", "fdisk", "mount", "smartcols", "uuid"],
	},
};

export async function source() {
	const { name, version } = metadata;
	const series = version.split(".").slice(0, 2).join(".");
	const checksum =
		"sha256:fbd62a100ab7bb8746ba0661255c3c48185b1e9021507c624da01fbc696330ec";
	let source = await std
		.download({
			url: `https://www.kernel.org/pub/linux/utils/util-linux/v${series}/${name}-${version}.tar.xz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);

	// Wrap the header generators to use bash, to avoid their shebangs failing to find /bin/bash.
	for (const subpath of ["tools/all_errnos", "tools/all_syscalls"]) {
		const script = await source.get(subpath).then(tg.File.expect);
		const wrapped = await bash.wrapScript(script, std.triple.host());
		source = await tg.directory(source, { [subpath]: wrapped });
	}

	return source;
}

export type Arg = std.autotools.Arg;

export async function build(...args: tg.Args<Arg>) {
	// The installation cannot chown or setuid files. The login tools need PAM, setpriv needs libcap-ng, and the remaining optional dependencies are disabled explicitly so that detection does not depend on the build environment.
	const arg = await std.autotools.arg(
		{
			source: source(),
			phases: {
				configure: {
					args: [
						"--disable-chfn-chsh",
						"--disable-liblastlog2",
						"--disable-login",
						"--disable-makeinstall-chown",
						"--disable-makeinstall-setuid",
						"--disable-nls",
						"--disable-nologin",
						"--disable-runuser",
						"--disable-setpriv",
						"--disable-su",
						"--disable-sulogin",
						"--without-ncurses",
						"--without-ncursesw",
						"--without-python",
						"--without-systemd",
						"--without-tinfo",
						"--without-udev",
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
