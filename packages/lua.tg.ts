import * as std from "std" with { source: "./std" };

export const metadata = {
	builds: { exports: ["default", "build"] },
	homepage: "https://www.lua.org",
	license: "MIT",
	name: "lua",
	repository: "https://github.com/lua/lua",
	version: "5.4.9",
	tag: "lua/5.4.9",
	provides: {
		binaries: ["lua", "luac"],
		headers: ["lua.h", "lualib.h", "lauxlib.h"],
		libraries: [{ name: "lua", dylib: false, staticlib: true }],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:2335b6c582a52654f94612bf10d2f4672805d05329aa6568b1d8cd9e5c6fb8e6";
	return std
		.download({
			url: `https://www.lua.org/ftp/${name}-${version}.tar.gz`,
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
			buildInTree: true,
			order: ["prepare", "build", "install"],
			prefixArg: "none",
			source: source(),
		},
		...args,
	);

	// Build without readline, build the static library as position independent code, so that shared libraries such as librpmio can link it, and write a pkg-config file, which the upstream Makefile does not install.
	const platform =
		std.triple.os(arg.host) === "darwin"
			? "generic SYSCFLAGS=-DLUA_USE_MACOSX"
			: "linux";
	const { version } = metadata;
	const majorMinor = version.split(".").slice(0, 2).join(".");
	const pkgConfig = `prefix=\${pcfiledir}/../..
exec_prefix=\${prefix}
libdir=\${exec_prefix}/lib
includedir=\${prefix}/include

Name: Lua
Description: An extensible extension language
Version: ${version}
Libs: -L\${libdir} -llua -lm
Cflags: -I\${includedir}
`;
	const phases = std.phases.arg(arg.phases ?? null, {
		build: `make ${platform} -j"$(nproc)" CC=cc MYCFLAGS=-fPIC`,
		install: tg`make install INSTALL_TOP=${tg.output}`,
	});
	const output = await std.autotools.build({ ...arg, phases });
	const pkgConfigFile = tg.file(pkgConfig);
	return tg.directory(output, {
		["lib/pkgconfig/lua.pc"]: pkgConfigFile,
		[`lib/pkgconfig/lua${majorMinor}.pc`]: tg.symlink("lua.pc"),
	});
}

export default build;

export async function test() {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.binaries(metadata.provides.binaries, {
			lua: { testArgs: ["-v"], snapshot: `Lua ${metadata.version}` },
			luac: { testArgs: ["-v"], snapshot: `Lua ${metadata.version}` },
		}),
	};
	return await std.assert.pkg(build, spec);
}
