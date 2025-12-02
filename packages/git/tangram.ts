import * as curl from "curl" with { local: "../curl" };
import * as libpsl from "libpsl" with { local: "../libpsl" };
import * as libiconv from "libiconv" with { local: "../libiconv" };
import * as openssl from "openssl" with { local: "../openssl" };
import * as std from "std" with { local: "../std" };
import { $ } from "std" with { local: "../std" };
import * as zlib from "zlib" with { local: "../zlib" };
import * as zstd from "zstd" with { local: "../zstd" };

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

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		curl?: std.args.DependencyArg<curl.Arg>;
		libiconv?: std.args.DependencyArg<libiconv.Arg>;
		libpsl?: std.args.DependencyArg<libpsl.Arg>;
		openssl?: std.args.DependencyArg<openssl.Arg>;
		zlib?: std.args.DependencyArg<zlib.Arg>;
		zstd?: std.args.DependencyArg<zstd.Arg>;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: dependencyArgs = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const os = std.triple.os(host);

	const sourceDir = source_ ?? source();

	const configure = {
		args: ["--without-tcltk"],
	};

	const phases = {
		configure,
	};

	const dependencies = [
		std.env.runtimeDependency(curl.build, dependencyArgs.curl),
		std.env.runtimeDependency(libpsl.build, dependencyArgs.libpsl),
		std.env.runtimeDependency(openssl.build, dependencyArgs.openssl),
		std.env.runtimeDependency(zlib.build, dependencyArgs.zlib),
		std.env.runtimeDependency(zstd.build, dependencyArgs.zstd),
	];

	if (os === "darwin") {
		dependencies.push(
			std.env.runtimeDependency(libiconv.build, dependencyArgs.libiconv),
		);
	}

	const env = std.env.arg(
		...dependencies.map((dep: any) =>
			std.env.envArgFromDependency(build, env_, host, sdk, dep),
		),
		env_,
	);

	let gitArtifact = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			buildInTree: true,
			env,
			phases,
			sdk,
			setRuntimeLibraryPath: os === "linux",
			source: sourceDir,
		},
		autotools,
	);

	// Wrap the git binary with GIT_EXEC_PATH so it can find its helper programs.
	const wrappedGit = await std.wrap(
		tg.symlink({ artifact: gitArtifact, path: "bin/git" }),
		{
			env: {
				GIT_EXEC_PATH: tg`${gitArtifact}/libexec/git-core`,
			},
		},
	);

	return tg.directory(gitArtifact, {
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
