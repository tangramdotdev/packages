import * as std from "std" with { local: "../std" };
import * as openssl from "openssl" with { local: "../openssl.tg.ts" };
import * as libiconv from "libiconv" with { local: "../libiconv.tg.ts" };
import * as libxml2 from "libxml2" with { local: "../libxml2.tg.ts" };
import * as xz from "xz" with { local: "../xz.tg.ts" };
import * as zlib from "zlib-ng" with { local: "../zlib-ng.tg.ts" };

export const metadata = {
	homepage: "https://github.com/apple-oss-distributions/xar",
	hostPlatforms: ["aarch64-darwin", "x86_64-darwin"],
	license: "BSD-3-Clause",
	name: "xar",
	repository: "https://github.com/mackyle/xar/tree/master",
	version: "498",
	tag: "xar/498",
	provides: {
		binaries: ["xar"],
	},
};

// NOTE - patches lifted from MacPorts and combined: https://github.com/macports/macports-ports/tree/master/archivers/xar/files
import patches from "./patches" with { type: "directory" };

const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:9cee4f80b96cf592ccc545a4fdd51e4da4a5bd3b4734901637d67b043eff3c75";
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
};

const deps = () =>
	std.deps({
		libiconv: libiconv.build,
		libxml2: { build: libxml2.build, kind: "full" },
		openssl: openssl.build,
		xz: xz.build,
		zlib: zlib.build,
	});

export type Arg = std.autotools.Arg & std.deps.Arg<ReturnType<typeof deps>>;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{
			source: source(),
			deps: deps(),
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
};

export default build;

export const test = async () => {
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
};
