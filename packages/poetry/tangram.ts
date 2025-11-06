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
	version: "2.2.1",
	tag: "poetry/2.2.1",
	provides: {
		binaries: ["poetry"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:bef9aa4bb00ce4c10b28b25e7bac724094802d6958190762c45df6c12749b37c";
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
	python?: python.Arg;
};

/** Create an environment with poetry installed. */
export const self = async (...args: std.Args<Arg>) => {
	const {
		build,
		host,
		python: pythonArg = {},
	} = await std.packages.applyArgs<Arg>(...args);

	return python.self(
		{
			build,
			host,
			requirements: requirementsTxt,
		},
		pythonArg,
	);
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

	/** Optional Python arguments. */
	python?: python.Arg;

	// TODO: groups, preferWheel vs sdist
};

/** Build a poetry project. */
export const build = async (args: BuildArgs) => {
	const host = args.host ?? (await std.triple.host());
	const build = args.build ?? host;

	// Construct the poetry tool environment.
	// Note: poetry itself uses the default Python version to match requirements.txt.
	const poetryArtifact = await self({
		build,
		host,
	});
	console.log(`poetryArtifact`, poetryArtifact.id);

	// Construct the project Python environment.
	const projectPython = await python.self({
		build,
		host,
		...(args.python && args.python),
	});
	console.log(`projectPython`, projectPython.id);

	const poetryLock =
		args.lockfile ??
		(await args.source.get("poetry.lock").then(tg.File.expect));
	tg.assert(poetryLock, "could not locate poetry.lock");

	// Parse the lockfile into a requirements.txt. Note: we do not use poetry export, as the lockfile may be missing hashes.
	const requirements = await lockfile.requirements(poetryLock);
	console.log("requirements from poetry.lock", requirements.id);

	// Install the requirements specified by the poetry.lock file using the project Python.
	const installedRequirements = python.requirements.install(
		projectPython,
		requirements,
	);
	console.log(`installedRequirements: ${(await installedRequirements).id}`);

	// Install the source distribution.
	const source = tg.directory(args.source, {
		["poetry.lock"]: args.lockfile,
	});
	console.log(`source: ${(await source).id}`);

	// Set up certificates for HTTPS requests.
	const certFile = tg`${std.caCertificates()}/cacert.pem`;

	// Create env with both poetry (for the tool) and projectPython (for building).
	const env = await std.env.arg(projectPython, poetryArtifact, {
		PYTHONPATH: tg.Mutation.suffix(
			tg`${installedRequirements}/lib/python3/site-packages`,
			":",
		),
		SSL_CERT_FILE: certFile,
		REQUESTS_CA_BUNDLE: certFile,
		PIP_CERT: certFile,
	});
	console.log("env", env);

	const sdist = await $`
		set -x
		# Create a writable temporary directory for poetry.
		mkdir -p $PWD/tmp
		export TMPDIR=$PWD/tmp

		# Create a writable cache directory for poetry.
		mkdir -p $PWD/.cache/poetry
		export POETRY_CACHE_DIR=$PWD/.cache/poetry

		# Disable keyring to avoid macOS Keychain access.
		export PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring

		# Create the virtual env to install to.
		python3 -m venv $OUTPUT --copies
		export VIRTUAL_ENV=$OUTPUT

		poetry install --no-interaction --only-root --directory ${source} -vvv`
		.env(env)
		.network(true)
		.checksum("sha256:any")
		.then(tg.Directory.expect);

	// Merge the installed sdist with the requirements.
	const installed = await tg.directory(installedRequirements, sdist);

	// Determine the Python version string for the project.
	const pythonVersionString = args.python?.pythonVersion
		? python.versions[args.python.pythonVersion].version
		: python.versions[python.defaultVersion].version;

	// Wrap any binaries that appear using the project Python.
	return python.wrapScripts(
		await tg.symlink(
			tg`${projectPython}/bin/python${python.versionString(pythonVersionString)}`,
		),
		projectPython,
		installed,
	);
};

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(self, spec);
};
