import * as gmp from "gmp" with { local: "./gmp" };
import * as nettle from "nettle" with { local: "./nettle.tg.ts" };
import * as std from "std" with { local: "./std" };
import * as zlib from "zlib" with { local: "./zlib.tg.ts" };
import * as zstd from "zstd" with { local: "./zstd.tg.ts" };

export const metadata = {
	homepage: "https://www.gnutls.org",
	license: "LGPL-2.1-or-later",
	name: "gnutls",
	repository: "https://gitlab.com/gnutls/gnutls",
	version: "3.8.9",
	tag: "gnutls/3.8.9",
	provides: {
		libraries: ["gnutls"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:69e113d802d1670c4d5ac1b99040b1f2d5c7c05daec5003813c049b5184820ed";
	const extension = ".tar.xz";
	const base = `https://www.gnupg.org/ftp/gcrypt/${name}/v3.8`;
	return std.download
		.extractArchive({ base, checksum, name, extension, version })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

const deps = await std.deps({
	gmp: gmp.build,
	nettle: nettle.build,
	zlib: zlib.build,
	zstd: zstd.build,
});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		std.autotools.arg(
			{
				source: source(),
				deps,
				env: {
					CFLAGS: tg.Mutation.prefix(
						"-Wno-implicit-int -Wno-deprecated-non-prototype",
						" ",
					),
				},
				phases: {
					configure: {
						args: [
							"--disable-doc",
							"--with-included-libtasn1",
							"--with-included-unistring",
							"--without-p11-kit",
						],
					},
				},
			},
			...args,
		),
	);

export default build;

export const test = async () => {
	const spec: std.assert.PackageSpec = {
		...std.assert.defaultSpec(metadata),
		libraries: std.assert.allLibraries(["gnutls"], {
			runtimeDeps: [nettle.build(), gmp.build(), zlib.build(), zstd.build()],
			staticlib: false,
		}),
	};
	return await std.assert.pkg(build, spec);
};
