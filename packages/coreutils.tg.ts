import * as acl from "acl" with { local: "./acl.tg.ts" };
import * as attr from "attr" with { local: "./attr" };
import * as libcap from "libcap" with { local: "./libcap.tg.ts" };
import * as libiconv from "libiconv" with { local: "./libiconv.tg.ts" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/coreutils/",
	license: "GPL-3.0-or-later",
	name: "coreutils",
	repository: "http://git.savannah.gnu.org/gitweb/?p=coreutils.git",
	version: "9.8",
	tag: "coreutils/9.8",
	provides: {
		binaries: [
			"cp",
			"ls",
			"mv",
			"rm",
			"shuf",
			"sort",
			"tail",
			"tee",
			"touch",
			"true",
			"uname",
			"uniq",
			"wc",
			"whoami",
			"yes",
		],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:e6d4fd2d852c9141a1c2a18a13d146a0cd7e45195f72293a4e4c044ec6ccca15";
	const source = await std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});

	return source;
};

const deps = await std.deps({
	acl: {
		build: acl.build,
		kind: "runtime",
		when: (ctx) => std.triple.os(ctx.host) === "linux",
	},
	attr: {
		build: attr.build,
		kind: "runtime",
		when: (ctx) => std.triple.os(ctx.host) === "linux",
	},
	libcap: {
		build: libcap.build,
		kind: "runtime",
		when: (ctx) => std.triple.os(ctx.host) === "linux",
	},
	libiconv: {
		build: libiconv.build,
		kind: "runtime",
		when: (ctx) => std.triple.os(ctx.host) === "darwin",
	},
});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		{
			source: source(),
			deps,
			env: { FORCE_UNSAFE_CONFIGURE: true },
		},
		...args,
	);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
