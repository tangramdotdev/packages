import * as bzip2 from "bzip2" with { local: "./bzip2" };
import * as libiconv from "libiconv" with { local: "./libiconv.tg.ts" };
import * as openssl from "openssl" with { local: "./openssl.tg.ts" };
import * as std from "std" with { local: "./std" };
import * as xz from "xz" with { local: "./xz.tg.ts" };
import * as zlib from "zlib-ng" with { local: "./zlib-ng.tg.ts" };

export const metadata = {
	homepage: "https://libarchive.org",
	license:
		"https://raw.githubusercontent.com/libarchive/libarchive/master/COPYING",
	name: "libarchive",
	repository: "https://github.com/libarchive/libarchive",
	version: "3.7.7",
	tag: "libarchive/3.7.7",
	provides: {
		libraries: ["archive"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:879acd83c3399c7caaee73fe5f7418e06087ab2aaf40af3e99b9e29beb29faee";
	const extension = ".tar.xz";
	const base = `https://www.libarchive.org/downloads`;
	return std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

const deps = std.deps({
	bzip2: bzip2.build,
	libiconv: libiconv.build,
	openssl: openssl.build,
	xz: xz.build,
	zlib: zlib.build,
});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		{
			source: source(),
			deps,
			phases: {
				configure: {
					args: [
						"--disable-dependency-tracking",
						"--disable-rpath",
						"--with-pic",
					],
				},
			},
		},
		...args,
	);

export default build;

export const test = async () => {
	const spec: std.assert.PackageSpec = {
		...std.assert.defaultSpec(metadata),
		libraries: std.assert.allLibraries(["archive"], {
			runtimeDeps: [
				openssl.build(),
				zlib.build(),
				bzip2.build(),
				libiconv.build(),
				xz.build(),
			],
		}),
	};
	return await std.assert.pkg(build, spec);
};
