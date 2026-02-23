import * as python from "python" with { local: "../python" };
import * as std from "std" with { local: "../std" };

import * as lockfile from "./lockfile.tg.ts";
import requirementsTxt from "./requirements.txt" with { type: "file" };

export const metadata = {
	homepage: "https://python-poetry.org",
	license: "MIT",
	name: "poetry",
	repository: "https://github.com/python-poetry/poetry",
	version: "2.3.2",
	tag: "poetry/2.3.2",
	provides: {
		binaries: ["poetry"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:6e81526ae99a4f07f75174600bfe8b73e74c786dc18c9d1ce1800dd6f807414b";
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

export type Arg = std.args.BasePackageArg & {
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
	return python.build({
		source: await source(),
		python: { build, host, requirements },
	});
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

	/** Package names to exclude from lockfile requirements. */
	exclude?: Array<string>;

	/** Additional artifacts to include in site-packages. */
	sitePackages?: Record<string, tg.Unresolved<tg.Artifact>>;

	// TODO: groups, preferWheel vs sdist
};

/** Build a poetry project. */
export const build = async (args: BuildArgs) => {
	const host = args.host ?? std.triple.host();
	const buildTriple = args.build ?? host;

	// Build a base python environment for requirements installation.
	const pythonArtifact = await python.self({
		build: buildTriple,
		host,
	});

	const poetryLock =
		args.lockfile ??
		(await args.source.get("poetry.lock").then(tg.File.expect));
	tg.assert(poetryLock, "could not locate poetry.lock");

	// Parse the lockfile into a requirements.txt.
	const requirements = await lockfile.requirements({
		lockFile: poetryLock,
		exclude: args.exclude,
	});

	// Install the requirements specified by the poetry.lock file.
	const installedRequirements = await python.requirements.install(
		pythonArtifact,
		requirements,
	);

	// Read the pyproject.toml for poetry metadata.
	const pyprojectTomlFile = await args.source
		.get("pyproject.toml")
		.then(tg.File.expect);
	const pyprojectToml = tg.encoding.toml.decode(
		await pyprojectTomlFile.text,
	) as PoetryPyProjectToml;

	const poetryMeta = pyprojectToml.tool?.poetry;
	tg.assert(poetryMeta?.name, "Missing tool.poetry.name in pyproject.toml");

	const name = poetryMeta.name.toLowerCase().replaceAll("-", "_");
	const version = poetryMeta.version;

	// Determine the package source directory.
	// Check [tool.poetry.packages] first, then src/${name}, then ${name}.
	let packageDir: tg.Directory;
	if (poetryMeta.packages && poetryMeta.packages.length > 0) {
		const pkg = poetryMeta.packages[0];
		const from = pkg.from ?? ".";
		const path = from === "." ? pkg.include : `${from}/${pkg.include}`;
		packageDir = tg.Directory.expect(await args.source.get(path));
	} else {
		const srcLayout = await args.source.tryGet(`src/${name}`);
		if (srcLayout) {
			packageDir = tg.Directory.expect(srcLayout);
		} else {
			packageDir = tg.Directory.expect(await args.source.get(name));
		}
	}

	// Merge the package source with any existing package in site-packages from requirements.
	const existingPackage = await installedRequirements.tryGet(
		`lib/python3/site-packages/${name}`,
	);
	const mergedPackage =
		existingPackage instanceof tg.Directory
			? tg.directory(existingPackage, packageDir)
			: packageDir;

	// Build site-packages with the source package and dist-info.
	const sitePackages: Record<string, tg.Unresolved<tg.Artifact>> = {
		[name]: mergedPackage,
	};
	if (version) {
		sitePackages[`${name}-${version}.dist-info`] = tg.directory({
			METADATA: tg.file(
				`Metadata-Version: 2.1\nName: ${name}\nVersion: ${version}\n`,
			),
		});
	}

	// Include any additional vendored site-packages.
	if (args.sitePackages) {
		for (const [pkgName, artifact] of Object.entries(args.sitePackages)) {
			sitePackages[pkgName] = artifact;
		}
	}

	// Merge requirements with the source package.
	const installed = await tg.directory(installedRequirements, {
		["lib/python3/site-packages"]: sitePackages,
	});

	// Generate scripts from [tool.poetry.scripts].
	const scripts = poetryMeta.scripts ?? {};
	let binDir = tg.directory();
	for (const [scriptName, reference] of Object.entries(scripts)) {
		const [object, attribute] = reference.split(":");
		tg.assert(object);
		tg.assert(attribute);

		const script = tg.file`
			# Generated by tangram://poetry
			import sys
			from ${object} import ${attribute}
			sys.exit(${attribute}())`;

		binDir = tg.directory(binDir, {
			[scriptName]: std.wrap({
				executable: script,
				interpreter: tg.symlink(
					tg`${pythonArtifact}/bin/python${python.versionString()}`,
				),
				env: {
					PYTHONPATH: tg.Mutation.suffix(
						tg`${installed}/lib/python3/site-packages`,
						":",
					),
				},
			}),
		});
	}

	// Also include any existing bin scripts from requirements.
	const reqBin = await installedRequirements.tryGet("bin");
	if (reqBin instanceof tg.Directory) {
		binDir = tg.directory(reqBin, binDir);
	}

	return tg.directory({
		bin: binDir,
		["lib/python3/site-packages"]: tg.symlink(
			tg`${installed}/lib/python3/site-packages`,
		),
	});
};

type PoetryPyProjectToml = {
	tool?: {
		poetry?: {
			name: string;
			version?: string;
			scripts?: Record<string, string>;
			packages?: Array<{ include: string; from?: string }>;
		};
	};
};

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(self, spec);
};
