import * as python from "python" with { path: "../python" };
import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

import * as lockfile from "./lockfile.tg.ts";
import requirementsTxt from "./requirements.txt" with { type: "file" };

export const metadata = {
	homepage: "https://python-poetry.org",
	license: "MIT",
	name: "poetry",
	repository: "https://github.com/python-poetry/poetry",
	version: "1.8.4",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:909cc7651508ee6c1eabdfa56c3eded62222516029bf2fc313c47270bba1ad9a";
	const owner = "python-poetry";
	const repo = name;
	const tag = version;

	return std.download.fromGithub({
		owner,
		repo,
		tag,
		source: "release",
		version,
		checksum,
	});
});

export type Arg = {
	requirements?: tg.File;
	build?: string;
	host?: string;
};

/** Create an environment with poetry installed. */
export const poetry = tg.target(async (...args: std.Args<Arg>) => {
	const {
		build,
		host,
		requirements: requirements_,
	} = await std.args.apply<Arg>(...args);
	const requirements = requirements_ ?? requirementsTxt;
	return python.toolchain({
		build,
		host,
		requirements,
	});
});

export default poetry;

export type BuildArgs = {
	/** The source directory to build. */
	source: tg.Directory;

	/** The lockfile. Must contain hashes. */
	lockfile: tg.File;

	/** The system to build upon. */
	build?: string;

	/** The system to compile for. */
	host?: string;

	// TODO: groups, preferWheel vs sdist
};

/** Build a poetry project. */
export const build = tg.target(async (args: BuildArgs) => {
	const host = args.host ?? (await std.triple.host());
	const build = args.build ?? host;
	// Construct the basic build environment.
	const poetryArtifact = await poetry({
		build,
		host,
	});

	// Parse the lockfile into a requirements.txt. Note: we do not use poetry export, as the lockfile may be missing hashes.
	const requirements = await lockfile.requirements(args.lockfile);

	// Install the requirements specified by the poetry.lock file.
	const installedRequirements = python.requirements.install(
		poetryArtifact,
		requirements,
	);

	// Install the source distribution.
	const source = tg.directory(args.source, {
		["poetry.lock"]: args.lockfile,
	});

	const sdist = await $`
				# Create the virtual env to install to.
				python3 -m venv $OUTPUT || true
				export VIRTUAL_ENV=$OUTPUT

				poetry install --only-root --directory ${source}
			`
		.env(poetryArtifact, {
			PYTHONPATH: tg.Mutation.suffix(
				tg`${installedRequirements}/lib/python3/site-packages}`,
				":",
			),
		})
		.then(tg.Directory.expect);

	// Merge the installed sdist with the requirements.
	const installed = await tg.directory(installedRequirements, sdist);

	// Wrap any binaries that appear.
	return python.wrapScripts(
		await tg.symlink(tg`${poetryArtifact}/bin/python${python.versionString()}`),
		poetryArtifact,
		installed,
	);
});

export const test = tg.target(async () => {
	return await $`
				mkdir -p $OUTPUT
				echo "Checking that we can run poetry: ${poetry()}."
				poetry --version
			`.env(poetry());
});
