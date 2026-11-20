import * as curl from "curl" with { source: "./curl.tg.ts" };
import * as libpsl from "libpsl" with { source: "./libpsl.tg.ts" };
import * as libiconv from "libiconv" with { source: "./libiconv.tg.ts" };
import * as openssl from "openssl" with { source: "./openssl.tg.ts" };
import * as rust from "rust" with { source: "./rust" };
import * as std from "std" with { source: "./std" };
import { $ } from "std" with { source: "./std" };
import * as zlib from "zlib-ng" with { source: "./zlib-ng.tg.ts" };
import * as zstd from "zstd" with { source: "./zstd.tg.ts" };

export const metadata = {
	builds: { exports: ["default", "build"] },
	homepage: "https://git-scm.com/",
	license: "GPL-2.0-only",
	name: "git",
	repository: "https://github.com/git/git",
	version: "2.56.1",
	tag: "git/2.56.1",
	provides: {
		binaries: ["git"],
	},
};

export async function source() {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const base = `https://mirrors.edge.kernel.org/pub/software/scm/${name}`;
	const checksum =
		"sha256:f0b0bf89264b9bd2e1c640363e7529643989da76281600473c50745cd34a607f";
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

// Define dependencies - libiconv is only needed on darwin.
export function deps() {
	return std.deps({
		curl: { build: curl.build, kind: "full" },
		libpsl: libpsl.build,
		libiconv: {
			build: libiconv.build,
			kind: "runtime",
			when: { hostOs: "darwin" },
		},
		openssl: openssl.build,
		rust: { build: rust.self, kind: "buildtime" },
		zlib: zlib.build,
		zstd: zstd.build,
	});
}

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export async function build(...args: tg.Args<Arg>) {
	const arg = await std.autotools.arg(
		{
			source: source(),
			deps,
			buildInTree: true,
			phases: {
				configure: { args: ["--without-tcltk"] },
			},
		},
		...args,
	);

	const setRuntimeLibraryPath =
		std.triple.os(arg.host) === "linux" ? true : arg.setRuntimeLibraryPath;

	// Git's Makefile runs cargo directly to build the `gitcore` crate for the build machine. On x86_64 Linux, rustc links with its self-contained lld by default, which cannot run in the sandbox, so link with the SDK's linker instead. Stable rustc accepts this flag only for x86_64 Linux, and other hosts do not use the self-contained lld by default.
	const useSdkLinker =
		std.triple.os(arg.build) === "linux" &&
		std.triple.arch(arg.build) === "x86_64";
	const env = useSdkLinker
		? await std.env.arg(arg.env ?? null, {
				RUSTFLAGS: tg.Mutation.suffix("-C linker-features=-lld", " "),
			})
		: arg.env;

	const output = await std.autotools.build({
		...arg,
		...(env !== undefined ? { env } : {}),
		...(setRuntimeLibraryPath !== undefined ? { setRuntimeLibraryPath } : {}),
	});

	// Wrap the git binary with GIT_EXEC_PATH so it can find its helper programs.
	const wrappedGit = await std.wrap(
		tg.symlink({ artifact: output, path: "bin/git" }),
		{
			env: {
				GIT_EXEC_PATH: tg`${output}/libexec/git-core`,
			},
		},
	);
	return tg.directory(output, {
		["bin/git"]: wrappedGit,
	});
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	await std.assert.pkg(build, spec);

	// Test that git clone works with https repositories.
	const result = await $`
		set -x
		echo "Testing git clone with https repository."
		mkdir -p ${tg.output}
		cd ${tg.output}
		git clone --depth 1 https://github.com/octocat/Hello-World.git
		echo "Clone completed successfully."
	`
		.env(build())
		.checksum("sha256:any")
		.network(true)
		.then(tg.Directory.expect);

	// Verify that the repository was cloned successfully.
	const clonedRepo = await result.get("Hello-World").then(tg.Directory.expect);
	tg.assert(clonedRepo);

	// Check for README file existence.
	const readme = await clonedRepo.tryGet("README");
	tg.assert(readme !== null);

	return true;
}
