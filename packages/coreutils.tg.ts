import * as acl from "acl" with { local: "./acl.tg.ts" };
import * as attr from "attr" with { local: "./attr" };
import * as libcap from "libcap" with { local: "./libcap.tg.ts" };
import * as libiconv from "libiconv" with { local: "./libiconv.tg.ts" };
import * as std from "std" with { local: "./std" };
import alwaysPreserveXattrsPatch from "./std/utils/coreutils-always-preserve-xattrs.patch" with { type: "file" };

export const metadata = {
	homepage: "https://www.gnu.org/software/coreutils/",
	license: "GPL-3.0-or-later",
	name: "coreutils",
	repository: "http://git.savannah.gnu.org/gitweb/?p=coreutils.git",
	version: "9.10",
	tag: "coreutils/9.10",
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
		"sha256:16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25";
	let source = await std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});

	// Apply the xattr preservation patch so that coreutils' own `install`
	// command preserves extended attributes during `make install`.
	source = await std.patch(source, alwaysPreserveXattrsPatch);

	return source;
};

export const deps = () =>
	std.deps({
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
