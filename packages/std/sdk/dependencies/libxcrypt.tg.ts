import * as std from "../../tangram.ts";
import * as bootstrap from "../../bootstrap.tg.ts";
import strchrConstFix from "./libxcrypt-strchr-const-fix.patch" with { type: "file" };

export const metadata = {
	homepage: "https://github.com/besser82/libxcrypt",
	name: "libxcrypt",
	license: "LGPL-2.1",
	repository: "https://github.com/besser82/libxcrypt",
	version: "4.5.2",
	tag: "libxcrypt/4.5.2",
};

export function source() {
	const { name, version } = metadata;
	const owner = "besser82";
	const repo = name;
	const tag = `v${version}`;
	const checksum =
		"sha256:71513a31c01a428bccd5367a32fd95f115d6dac50fb5b60c779d5c7942aec071";
	return std.download
		.fromGithub({
			checksum,
			compression: "xz",
			owner,
			source: "release",
			repo,
			tag,
			version,
		})
		.then((dir) => bootstrap.patchGnu(dir, strchrConstFix));
}

export type Arg = std.autotools.Arg;

export async function build(...args: tg.Args<Arg>) {
	return std.autotools.build(
		{
			source: source(),
			phases: {
				configure: {
					args: ["--disable-dependency-tracking"],
				},
			},
		},
		...args,
	);
}

export default build;

export async function test() {
	const directory = await build();
	await std.assert.fileExists({ directory, subpath: "include/crypt.h" });
	const host = std.triple.host();
	const testSource = `
		#include <crypt.h>
		#include <string.h>
		int main(void) {
			char *hash = crypt("password", "$6$salt$");
			return hash == 0 || strncmp(hash, "$6$salt$", 8) != 0;
		}
	`;
	await std.assert.assertDylib({
		directory,
		host,
		libraryName: "crypt",
		pkgConfigName: "libxcrypt",
		runtimeDepDirs: [],
		testSource,
	});
	const staticDirectory = await tg.directory({
		include: directory.get("include"),
		"lib/libcrypt.a": directory.get("lib/libcrypt.a"),
	});
	await std.assert.assertStaticlib({
		directory: staticDirectory,
		host,
		library: "crypt",
		testSource,
	});
	return true;
}

/** The tests in this module, grouped by tier. */
export const tests = {
	sdk: [test],
};
