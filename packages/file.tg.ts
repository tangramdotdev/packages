import * as bzip2 from "bzip2" with { local: "./bzip2" };
import * as libseccomp from "libseccomp" with { local: "./libseccomp.tg.ts" };
import * as std from "std" with { local: "./std" };
import * as xz from "xz" with { local: "./xz.tg.ts" };
import * as zlib from "zlib-ng" with { local: "./zlib-ng.tg.ts" };

export const metadata = {
	homepage: "https://www.darwinsys.com/file/",
	license: "https://github.com/file/file/blob/FILE5_45/COPYING",
	name: "file",
	repository: "https://github.com/file/file",
	version: "5.45",
	tag: "file/5.45",
	provides: {
		binaries: ["file"],
		headers: ["magic.h"],
		libraries: [{ name: "magic", staticlib: false, dylib: true }],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const extension = ".tar.gz";
	const checksum =
		"sha256:fc97f51029bb0e2c9f4e3bffefdaf678f0e039ee872b9de5c002a6d09c784d82";
	const base = `https://astron.com/pub/${name}`;
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export const deps = () =>
	std.deps({
		libseccomp: {
			build: libseccomp.build,
			kind: "runtime",
			when: (ctx) => std.triple.os(ctx.host) === "linux",
		},
		zlib: zlib.build,
	});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = async (...args: std.Args<Arg>) => {
	const output = await std.autotools.build(
		{
			source: source(),
			deps,
			hardeningCFlags: false,
			phases: {
				configure: {
					args: ["--disable-dependency-tracking", "--disable-silent-rules"],
				},
			},
		},
		...args,
	);
	// Always set MAGIC when using `file`.
	const magic = tg.directory({
		"magic.mgc": tg.File.expect(await output.get("share/misc/magic.mgc")),
	});
	const rawFile = tg.File.expect(await output.get("bin/file"));
	const wrappedFile = std.wrap(rawFile, {
		env: {
			MAGIC: tg.Mutation.setIfUnset(tg`${magic}/magic.mgc`),
		},
		libraryPaths: [tg.Directory.expect(await output.get("lib"))],
	});
	return tg.directory(output, {
		"bin/file": wrappedFile,
	});
};

export default build;

export const test = async () => {
	return await std.assert.pkg(build, {
		...std.assert.defaultSpec(metadata),
		libraries: [
			{
				name: "magic",
				staticlib: false,
				dylib: true,
				runtimeDeps: [
					zlib.build(),
					libseccomp.build(),
					xz.build(),
					bzip2.build(),
				],
			},
		],
	});
};
