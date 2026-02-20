import * as bzip2 from "bzip2" with { local: "./bzip2" };
import * as libarchive from "libarchive" with { local: "./libarchive.tg.ts" };
import * as openssl from "openssl" with { local: "./openssl.tg.ts" };
import * as std from "std" with { local: "./std" };
import * as xz from "xz" with { local: "./xz.tg.ts" };
import * as zlib from "zlib-ng" with { local: "./zlib-ng.tg.ts" };

export const metadata = {
	homepage: "https://sourceware.org/elfutils/",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-3.0-or-later",
	name: "elfutils",
	repository: "https://sourceware.org/git/?p=elfutils.git;a=summary",
	version: "0.194",
	tag: "elfutils/0.194",
	provides: {
		binaries: [
			"eu-addr2line",
			"eu-ar",
			"eu-elfclassify",
			"eu-elfcmp",
			"eu-elfcompress",
			"eu-elflint",
			"eu-findtextrel",
			"eu-nm",
			"eu-objdump",
			"eu-readelf",
			"eu-size",
			"eu-stack",
			"eu-strings",
			"eu-strip",
			"eu-unstrip",
		],
		headers: ["libelf.h", "gelf.h"],
		libraries: ["elf", "dw", "asm"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:09e2ff033d39baa8b388a2d7fbc5390bfde99ae3b7c67c7daaf7433fbcf0f01e";
	const extension = ".tar.bz2";
	const base = `https://sourceware.org/elfutils/ftp/${version}`;
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export const deps = () =>
	std.deps({
		bzip2: bzip2.build,
		libarchive: libarchive.build,
		openssl: openssl.build,
		xz: xz.build,
		zlib: zlib.build,
	});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{
			source: source(),
			deps,
			env: {
				CFLAGS: tg.Mutation.suffix("-Wno-format-nonliteral", " "),
			},
			phases: {
				configure: {
					args: [
						"--enable-deterministic-archives",
						"--program-prefix=eu-",
						"--disable-nls",
						"--disable-rpath",
						"--enable-install-elfh",
						"--without-libiconv-prefix",
						"--without-libintl-prefix",
						// FIXME - figure out how to get debuginfod to build.
						"--disable-debuginfod",
						"--enable-libdebuginfod=dummy",
					],
				},
			},
		},
		...args,
	);

	// The linker needs rpath-link to find transitive .so deps (zlib, lzma, bz2) referenced by the internal libelf.so and libdw.so during the build.
	const {
		zlib: zlibArtifact,
		xz: xzArtifact,
		bzip2: bzip2Artifact,
	} = await std.deps.artifacts(deps, arg);
	const env = std.env.arg(arg.env, {
		LDFLAGS: tg.Mutation.suffix(
			tg`-Wl,-rpath-link,${zlibArtifact}/lib:${xzArtifact}/lib:${bzip2Artifact}/lib`,
			" ",
		),
	});

	return std.autotools.build({ ...arg, env });
};

export default build;

export const test = async () => {
	const runtimeDeps = [zlib.build(), xz.build(), bzip2.build()];
	return await std.assert.pkg(build, {
		...std.assert.defaultSpec(metadata),
		libraries: [
			{ name: "elf", runtimeDeps },
			{ name: "dw", runtimeDeps },
			{ name: "asm", runtimeDeps },
		],
	});
};
