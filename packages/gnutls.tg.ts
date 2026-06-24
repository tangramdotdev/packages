import * as gmp from "gmp" with { source: "./gmp" };
import * as nettle from "nettle" with { source: "./nettle.tg.ts" };
import * as std from "std" with { source: "./std" };
import * as zlib from "zlib-ng" with { source: "./zlib-ng.tg.ts" };
import * as zstd from "zstd" with { source: "./zstd.tg.ts" };

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

export async function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:69e113d802d1670c4d5ac1b99040b1f2d5c7c05daec5003813c049b5184820ed";
	const extension = ".tar.xz";
	const base = `https://www.gnupg.org/ftp/gcrypt/${name}/v3.8`;
	return std.download
		.extractArchive({ base, checksum, name, extension, version })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export function deps() {
	return std.deps({
		gmp: gmp.build,
		nettle: nettle.build,
		zlib: zlib.build,
		zstd: zstd.build,
	});
}

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export function build(...args: std.Args<Arg>) {
	return std.autotools.build(
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
	);
}

export default build;

export async function test() {
	const spec: std.assert.PackageSpec = {
		...std.assert.defaultSpec(metadata),
		libraries: std.assert.allLibraries(["gnutls"], {
			runtimeDeps: [nettle.build(), gmp.build(), zlib.build(), zstd.build()],
			staticlib: false,
		}),
	};
	return await std.assert.pkg(build, spec);
}
