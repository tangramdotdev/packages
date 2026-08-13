import * as std from "std" with { source: "../std" };
import * as openssl from "openssl" with { source: "../openssl.tg.ts" };
import * as libiconv from "libiconv" with { source: "../libiconv.tg.ts" };
import * as libxml2 from "libxml2" with { source: "../libxml2.tg.ts" };
import * as xz from "xz" with { source: "../xz.tg.ts" };
import * as zlib from "zlib-ng" with { source: "../zlib-ng.tg.ts" };

export const metadata = {
	homepage: "https://github.com/apple-oss-distributions/xar",
	hostPlatforms: ["aarch64-darwin", "x86_64-darwin"],
	license: "BSD-3-Clause",
	name: "xar",
	repository: "https://github.com/mackyle/xar/tree/master",
	version: "503",
	tag: "xar/503",
	provides: {
		binaries: ["xar"],
	},
};

// NOTE - patches lifted from MacPorts and combined: https://github.com/macports/macports-ports/tree/master/archivers/xar/files
import patches from "./patches" with { type: "directory" };

async function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:43b9b5149e4046cf98dcf7c03330b008e04d23e3f029a698a5618adee10ccbb2";
	const owner = "apple-oss-distributions";
	const repo = name;
	const tag = `${name}-${version}`;
	return std.download
		.fromGithub({
			checksum,
			owner,
			repo,
			source: "tag",
			tag,
		})
		.then((d) => d.get(name))
		.then(tg.Directory.expect)
		.then((d) => std.patch(d, patches));
}

export function deps() {
	return std.deps({
		libiconv: {
			build: libiconv.build,
			kind: "runtime",
			when: { hostOs: "darwin" },
		},
		libxml2: { build: libxml2.build, kind: "full" },
		openssl: openssl.build,
		xz: xz.build,
		zlib: zlib.build,
	});
}

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export async function build(...args: tg.Args<Arg>) {
	const arg = await std.autotools.arg(
		{
			source: source(),
			deps,
			buildInTree: true,
			developmentTools: true,
			// NOTE - this define is included in libxml/encoding.h but not expanding.
			env: {
				CFLAGS: tg.Mutation.suffix("-DUTF8Toisolat1=xmlUTF8ToIsolat1", " "),
			},
			phases: {
				configure: { pre: "./autogen.sh" },
			},
		},
		...args,
	);
	std.assert.supportedHost(arg.host, metadata);
	return std.autotools.build(arg);
}

export default build;

export async function test() {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: [
			{
				name: "xar",
				snapshot: "xar 1.8dev",
			},
		],
	};
	return await std.assert.pkg(build, spec);
}
