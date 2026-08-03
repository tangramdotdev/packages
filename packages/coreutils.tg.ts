import * as acl from "acl" with { source: "./acl.tg.ts" };
import * as attr from "attr" with { source: "./attr" };
import * as libcap from "libcap" with { source: "./libcap.tg.ts" };
import * as libiconv from "libiconv" with { source: "./libiconv.tg.ts" };
import * as std from "std" with { source: "./std" };
import alwaysPreserveXattrsPatch from "./std/utils/coreutils-always-preserve-xattrs.patch" with { type: "file" };

export const metadata = {
	homepage: "https://www.gnu.org/software/coreutils/",
	license: "GPL-3.0-or-later",
	name: "coreutils",
	repository: "http://git.savannah.gnu.org/gitweb/?p=coreutils.git",
	version: "9.11",
	tag: "coreutils/9.11",
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

export async function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:394024eda0a5955217ceda9cd1201e65dc8fa3aa29c2951135a49521d57c3cc3";
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
}

export function deps() {
	return std.deps({
		acl: {
			build: acl.build,
			kind: "runtime",
			when: { hostOs: "linux" },
		},
		attr: {
			build: attr.build,
			kind: "runtime",
			when: { hostOs: "linux" },
		},
		libcap: {
			build: libcap.build,
			kind: "runtime",
			when: { hostOs: "linux" },
		},
		libiconv: {
			build: libiconv.build,
			kind: "runtime",
			when: { hostOs: "darwin" },
		},
	});
}

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export function build(...args: tg.Args<Arg>) {
	return std.autotools.build(
		{
			source: source(),
			deps,
			env: { FORCE_UNSAFE_CONFIGURE: true },
		},
		...args,
	);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
