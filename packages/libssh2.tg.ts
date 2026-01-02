import * as openssl from "openssl" with { local: "./openssl.tg.ts" };
import * as std from "std" with { local: "./std" };
import * as zlib from "zlib-ng" with { local: "./zlib-ng.tg.ts" };

export const metadata = {
	homepage: "https://libssh2.org",
	license: "BSD-3-Clause",
	name: "libssh2",
	repository: "https://github.com/libssh2/libssh2",
	version: "1.11.1",
	tag: "libssh2/1.11.1",
	provides: {
		libraries: ["ssh2"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:9954cb54c4f548198a7cbebad248bdc87dd64bd26185708a294b2b50771e3769";
	const owner = name;
	const repo = name;
	const tag = `${name}-${version}`;
	return std.download.fromGithub({
		checksum,
		compression: "xz",
		owner,
		repo,
		source: "release",
		tag,
		version,
	});
};

const deps = std.deps({
	openssl: openssl.build,
	zlib: zlib.build,
});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build({ source: source(), deps }, ...args);

export default build;

export let test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
