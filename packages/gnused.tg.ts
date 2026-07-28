import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/sed/",
	license: "GPL-2.0-or-later",
	name: "sed",
	repository: "https://git.savannah.gnu.org/cgit/sed.git",
	version: "4.10",
	tag: "gnused/4.10",
	provides: {
		binaries: ["sed"],
	},
};

function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:b8e72182b2ec96a3574e2998c47b7aaa64cc20ce000d8e9ac313cc07cecf28c7";
	return std.download.fromGnu({
		name,
		version,
		checksum,
		compression: "xz",
	});
}

export type Arg = std.autotools.Arg;

export function build(...args: tg.Args<Arg>) {
	return std.autotools.build(
		{
			source: source(),
			phases: {
				configure: { args: ["--disable-dependency-tracking"] },
			},
		},
		...args,
	);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
