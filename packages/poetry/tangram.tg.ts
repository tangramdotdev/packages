import * as python from "tg:python" with { path: "../python" };
import * as std from "tg:std" with { path: "../std" };

import * as lockfile from "./lockfile.tg.ts";

export let metadata = {
	name: "poetry",
	version: "1.7.1",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:b348a70e7d67ad9c0bd3d0ea255bc6df84c24cf4b16f8d104adb30b425d6ff32";
	let owner = "python-poetry";
	let repo = name;
	let tag = version;

	return std.download.fromGithub({
		owner,
		repo,
		tag,
		version,
		release: true,
		checksum,
	});
});

export type Arg = {
	source?: tg.Directory;
	host?: std.triple.Arg;
	target?: std.triple.Arg;
};

// In order to bootstrap poetry, we need to have poetry. Internally, poetry works by bootstrapping with the most recent version published to pypi.org. To mock this, we use a known 'good' requirements.txt created with pip-compile to install a version of poetry from the pypi registry safely.
export let requirements = tg.target(async () => {
	let requirements = await tg.include("./requirements.txt");
	return tg.File.expect(requirements);
});

/** Create an environment with poetry installed. */
export let poetry = tg.target(async (arg?: Arg) => {
	let sourceArtifact = arg?.source ?? (await source());
	return python.python({
		requirements: requirements(),
	});
});

export default tg.target((arg?: Arg) => poetry(arg));
export type BuildArgs = {
	/** The source directory to build. */
	source: tg.Directory;

	/** The lockfile. Must contain hashes. */
	lockfile: tg.File;

	/** The host system to build upon. */
	host?: std.triple.Arg;

	/** The target system to compile for. */
	target?: std.triple.Arg;

	// TODO: groups, preferWheel vs sdist
};

/** Build a poetry project. */
export let build = tg.target(async (args: BuildArgs) => {
	// Construct the basic build environment.
	let poetryArtifact = await poetry({
		host: args.host,
		target: args.target,
	});

	// Parse the lockfile into a requirements.txt. Note: we do not use poetry export, as the lockfile may be missing hashes.
	let requirements = await lockfile.requirements(args.lockfile);

	// Install the requirements specified by the poetry.lock file.
	let installedRequirements = python.requirements.install(
		poetryArtifact,
		requirements,
	);

	// Install the source distribution.
	let source = tg.directory(args.source, {
		["poetry.lock"]: args.lockfile,
	});

	let sdist = await std.build(
		tg`
				# Create the virtual env to install to.
				python3 -m venv $OUTPUT || true
				export VIRTUAL_ENV=$OUTPUT

				poetry install --only-root --directory ${source}
			`,
		{
			env: std.env(poetryArtifact, {
				PYTHONPATH: tg.Mutation.templateAppend(
					tg`${installedRequirements}/lib/python3/site-packages}`,
					":",
				),
			}),
		},
	);
	tg.Directory.assert(sdist);

	// Merge the installed sdist with the requirements.
	let installed = await tg.directory(installedRequirements, sdist);

	// Wrap any binaries that appear.
	return python.wrapScripts(
		await tg.symlink(tg`${poetryArtifact}/bin/python3.12`),
		poetryArtifact,
		installed,
	);
});

export let test = tg.target(async () => {
	await std.build(
		tg`
				mkdir -p $OUTPUT
				echo "Checking that we can run poetry: ${poetry()}."
				poetry --version
			`,
		{ env: poetry() },
	);
	return true;
});
