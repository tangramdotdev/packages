import * as lz4 from "lz4" with { source: "./lz4.tg.ts" };
import * as lzo from "lzo" with { source: "./lzo.tg.ts" };
import * as std from "std" with { source: "./std" };
import * as xz from "xz" with { source: "./xz.tg.ts" };
import * as zlib from "zlib-ng" with { source: "./zlib-ng.tg.ts" };
import * as zstd from "zstd" with { source: "./zstd.tg.ts" };

export const metadata = {
	builds: {
		exports: ["default", "build"],
		hosts: ["aarch64-linux", "x86_64-linux"],
	},
	homepage: "https://github.com/plougher/squashfs-tools",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-2.0-or-later",
	name: "squashfs-tools",
	repository: "https://github.com/plougher/squashfs-tools",
	version: "4.7.5",
	tag: "squashfs-tools/4.7.5",
	provides: {
		binaries: ["mksquashfs", "sqfscat", "sqfstar", "unsquashfs"],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:547b7b7f4d2e44bf91b6fc554664850c69563701deab9fd9cd7e21f694c88ea6";
	return std
		.download({
			url: `https://github.com/plougher/${name}/releases/download/${version}/${name}-${version}.tar.gz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export function deps() {
	return std.deps({
		lz4: lz4.build,
		lzo: lzo.build,
		xz: xz.build,
		zlib: zlib.build,
		zstd: zstd.build,
	});
}

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export async function build(...args: tg.Args<Arg>) {
	// Select every compressor, and install the manual pages that the release ships rather than generating them.
	const options =
		"GZIP_SUPPORT=1 LZ4_SUPPORT=1 LZO_SUPPORT=1 XZ_SUPPORT=1 ZSTD_SUPPORT=1 USE_PREBUILT_MANPAGES=y";
	const arg = await std.autotools.arg(
		{
			buildInTree: true,
			deps,
			order: ["prepare", "build", "install"],
			phases: {
				build: `make -C squashfs-tools -j"$(nproc)" ${options}`,
				install: tg`make -C squashfs-tools install ${options} INSTALL_PREFIX=${tg.output}`,
			},
			prefixArg: "none",
			source: source(),
		},
		...args,
	);
	std.assert.supportedHost(arg.host, metadata);
	return std.autotools.build(arg);
}

export default build;

export async function test() {
	// The tools take their options with a single dash, and unsquashfs exits with a failure after it prints its version.
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: metadata.provides.binaries.map((name) => ({
			name,
			testArgs: ["-version"],
			snapshot: metadata.version,
			exitOnErr: false,
		})),
	};
	return await std.assert.pkg(build, spec);
}
