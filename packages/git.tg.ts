import * as curl from "curl" with { local: "./curl.tg.ts" };
import * as libpsl from "libpsl" with { local: "./libpsl.tg.ts" };
import * as libiconv from "libiconv" with { local: "./libiconv.tg.ts" };
import * as openssl from "openssl" with { local: "./openssl.tg.ts" };
import * as std from "std" with { local: "./std" };
import { $ } from "std" with { local: "./std" };
import * as zlib from "zlib-ng" with { local: "./zlib-ng.tg.ts" };
import * as zstd from "zstd" with { local: "./zstd.tg.ts" };

export const metadata = {
	homepage: "https://git-scm.com/",
	license: "GPL-2.0-only",
	name: "git",
	repository: "https://github.com/git/git",
	version: "2.51.2",
	tag: "git/2.51.2",
	provides: {
		binaries: ["git"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const base = `https://mirrors.edge.kernel.org/pub/software/scm/${name}`;
	const checksum =
		"sha256:233d7143a2d58e60755eee9b76f559ec73ea2b3c297f5b503162ace95966b4e3";
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

// Define dependencies - libiconv is only needed on darwin.
export const deps = () =>
	std.deps({
		curl: curl.build,
		libpsl: libpsl.build,
		libiconv: {
			build: libiconv.build,
			kind: "runtime",
			when: (ctx) => std.triple.os(ctx.host) === "darwin",
		},
		openssl: openssl.build,
		zlib: zlib.build,
		zstd: zstd.build,
	});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = async (...args: std.Args<Arg>) => {
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

	const output = await std.autotools.build({
		...arg,
		setRuntimeLibraryPath,
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
};

export default build;

export const test = async () => {
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
	tg.assert(readme !== undefined);

	return true;
};
