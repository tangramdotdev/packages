import * as python from "python" with { local: "../python" };
import * as std from "std" with { local: "../std" };
import { $ } from "std" with { local: "../std" };

import * as lockfile from "./lockfile.tg.ts";
import requirementsTxt from "./requirements.txt" with { type: "file" };

export const metadata = {
	homepage: "https://python-poetry.org",
	license: "MIT",
	name: "poetry",
	repository: "https://github.com/python-poetry/poetry",
	version: "2.1.2",
	provides: {
		binaries: ["poetry"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:6a0694645ee24ba93cb94254db66e47971344562ddd5578e82bf35e572bc546d";
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
};

export type Arg = {
	build?: string;
	host?: string;
	requirements?: tg.File;
};

/** Create an environment with poetry installed. */
export const self = async (...args: std.Args<Arg>) => {
	const {
		build,
		host,
		requirements: requirements_,
	} = await std.packages.applyArgs<Arg>(...args);
	const requirements = requirements_ ?? requirementsTxt;
	return python.self({ build, host, requirements });
};

export default self;

export type BuildArgs = {
	/** The source directory to build. */
	source: tg.Directory;

	/** The lockfile. Must contain hashes. */
	lockfile?: tg.File;

	/** The system to build upon. */
	build?: string;

	/** The system to compile for. */
	host?: string;

	// TODO: groups, preferWheel vs sdist
};

/** Build a poetry project. */
export const build = async (args: BuildArgs) => {
	const host = args.host ?? (await std.triple.host());
	const build = args.build ?? host;
	// Construct the basic build environment.
	const poetryArtifact = await self({
		build,
		host,
	});
	console.log(`poetryArtifact`, poetryArtifact.id);

	const poetryLock =
		args.lockfile ??
		(await args.source.get("poetry.lock").then(tg.File.expect));
	tg.assert(poetryLock, "could not locate poetry.lock");

	// Parse the lockfile into a requirements.txt. Note: we do not use poetry export, as the lockfile may be missing hashes.
	const requirements = await lockfile.requirements(poetryLock);
	console.log("requirements from poetry.lock", requirements.id);

	// Install the requirements specified by the poetry.lock file.
	const installedRequirements = python.requirements.install(
		poetryArtifact,
		requirements,
	);
	console.log(`installedRequirements: ${(await installedRequirements).id}`);

	// Install the source distribution.
	const source = tg.directory(args.source, {
		["poetry.lock"]: args.lockfile,
	});
	console.log(`source: ${(await source).id}`);

	const env = await std.env.arg(poetryArtifact, {
		PYTHONPATH: tg.Mutation.suffix(
			tg`${installedRequirements}/lib/python3/site-packages`,
			":",
		),
	});
	console.log("env", env);

	const sdist = await $`
		set -x
		# Create the virtual env to install to.
		python3 -m venv $OUTPUT --copies
		export VIRTUAL_ENV=$OUTPUT

		poetry install --no-interaction --only-root --directory ${source} -vvv`
		.env(env)
		.then(tg.Directory.expect);

	// Merge the installed sdist with the requirements.
	const installed = await tg.directory(installedRequirements, sdist);

	// Wrap any binaries that appear.
	return python.wrapScripts(
		await tg.symlink(tg`${poetryArtifact}/bin/python${python.versionString()}`),
		poetryArtifact,
		installed,
	);
};

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(self, spec);
};
