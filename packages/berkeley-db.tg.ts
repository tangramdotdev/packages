import atomicCompareExchange from "./berkeley-db-atomic-compare-exchange.patch" with { type: "file" };
import * as std from "std" with { source: "./std" };

export const metadata = {
	builds: { exports: ["default", "build"] },
	homepage:
		"https://www.oracle.com/database/technologies/related/berkeleydb.html",
	license: "Sleepycat",
	name: "berkeley-db",
	repository: "https://github.com/berkeleydb/libdb",
	version: "5.3.28",
	tag: "berkeley-db/5.3.28",
	provides: {
		headers: ["db.h"],
		libraries: [{ name: "db", pkgConfigName: false }],
	},
};

export async function source() {
	const { version } = metadata;
	const checksum =
		"sha256:e0a992d740709892e81f9d93f06daf305cf73fb81b545afe72478043172c3628";
	const source = await std
		.download({
			url: `https://download.oracle.com/berkeley-db/db-${version}.tar.gz`,
			checksum,
			mode: "extract",
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
	return std.patch(source, atomicCompareExchange);
}

export type Arg = std.autotools.Arg;

export async function build(...args: tg.Args<Arg>) {
	// The configure script is in `dist`. Compile as C17 and allow the implicit declarations of the configure checks, which predate C23 and newer compilers. Leave out the C++, Java, and Tcl interfaces and the documentation.
	const sourceDir = await source();
	const arg = await std.autotools.arg(
		{
			env: {
				CFLAGS: tg.Mutation.suffix(
					"-std=gnu17 -Wno-error=implicit-function-declaration -Wno-error=implicit-int -Wno-error=incompatible-pointer-types",
					" ",
				),
			},
			phases: {
				configure: {
					command: tg`${sourceDir}/dist/configure`,
					args: [
						"--disable-cxx",
						"--disable-java",
						"--disable-tcl",
						"--enable-shared",
						"--enable-static",
					],
				},
				install: "make install_include install_lib install_utilities",
			},
			source: sourceDir,
		},
		...args,
	);
	return std.autotools.build(arg);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
