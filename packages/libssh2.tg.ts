import * as openssl from "openssl" with { source: "./openssl.tg.ts" };
import * as std from "std" with { source: "./std" };
import * as zlib from "zlib-ng" with { source: "./zlib-ng.tg.ts" };

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

export async function source() {
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
}

function dependencyDeclarations() {
	return std.deps({
		openssl: openssl.build,
		zlib: zlib.build,
	});
}

export async function deps() {
	return std.deps.toConfig(dependencyDeclarations());
}

export type Arg = std.autotools.Arg &
	std.deps.Arg<typeof dependencyDeclarations>;

export async function build(...args: tg.Args<Arg>) {
	return std.autotools.build(
		{ deps: await tg.command(deps), source: source() },
		...args,
	);
}

export default build;

export async function test() {
	return await std.assert.pkg(build, {
		...std.assert.defaultSpec(metadata),
		libraries: [
			{
				name: "ssh2",
				runtimeDeps: [openssl.build(), zlib.build()],
			},
		],
	});
}
