import * as std from "std" with { local: "../std" };
import { $ } from "std" with { local: "../std" };

import * as bzip2 from "bzip2" with { local: "../bzip2" };
import * as libffi from "libffi" with { local: "../libffi.tg.ts" };
import * as libxcrypt from "libxcrypt" with { local: "../libxcrypt.tg.ts" };
import * as mpdecimal from "mpdecimal" with { local: "../mpdecimal.tg.ts" };
import * as ncurses from "ncurses" with { local: "../ncurses.tg.ts" };
import * as openssl from "openssl" with { local: "../openssl.tg.ts" };
import * as readline from "readline" with { local: "../readline.tg.ts" };
import * as sqlite from "sqlite" with { local: "../sqlite.tg.ts" };
import * as zlib from "zlib-ng" with { local: "../zlib-ng.tg.ts" };
import * as zstd from "zstd" with { local: "../zstd.tg.ts" };

import * as requirements from "./requirements.tg.ts";
export { requirements };

/** Version metadata for each supported Python version. */
export const versions = {
	"3.13": {
		version: "3.13.9",
		checksum:
			"sha256:ed5ef34cda36cfa2f3a340f07cac7e7814f91c7f3c411f6d3562323a866c5c66",
	},
	"3.14": {
		version: "3.14.0",
		checksum:
			"sha256:2299dae542d395ce3883aca00d3c910307cd68e0b2f7336098c8e7b7eee9f3e9",
	},
} as const;

/** The default Python version. */
export const defaultVersion = "3.14" as const;

/** Package metadata for python (uses default version). */
export const metadata = {
	homepage: "https://www.python.org/",
	name: "python",
	license: "Python Software Foundation License",
	repository: "https://github.com/python/cpython",
	version: versions[defaultVersion].version,
	tag: `python/${versions[defaultVersion].version}`,
};

/** Return the MAJ.MIN version of python, used by some installation scripts. */
export const versionString = (version?: string) => {
	const versionToUse = version ?? metadata.version;
	const [maj, min, ..._] = versionToUse.split(".");
	return `${maj}.${min}`;
};

/** Return the source code for the specified Python version. */
export const source = async (
	pythonVersion?: keyof typeof versions,
): Promise<tg.Directory> => {
	const versionKey = pythonVersion ?? defaultVersion;
	const { version, checksum } = versions[versionKey];
	const extension = ".tar.xz";
	const base = `https://www.python.org/ftp/python/${version}`;
	const name = "Python";
	return await std.download
		.extractArchive({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

const deps = std.deps({
	bzip2: bzip2.build,
	libffi: libffi.build,
	libxcrypt: libxcrypt.build,
	mpdecimal: mpdecimal.build,
	ncurses: ncurses.build,
	openssl: openssl.build,
	readline: readline.build,
	sqlite: sqlite.build,
	zlib: zlib.build,
	zstd: zstd.build,
});

export type Arg = std.autotools.Arg &
	std.deps.Arg<typeof deps> & {
		/** Optional set of requirements, either as a requirements.txt file or as a string passed to pip install.
		 *
		 * Hashes are required!
		 */
		requirements?: requirements.Arg;

		/** The Python version to build. Defaults to the latest version. */
		pythonVersion?: keyof typeof versions;

		/** Build with --enable-optimizations? Not supported on macOS at the moment, enabled by default on Linux. */
		enableOptimizations?: boolean;
	};

/** Build and create a python environment. */
export const self = async (...args: std.Args<Arg>) => {
	// Extract custom options first.
	const customOptions = await std.args.apply<Arg, Arg>({
		args: args as std.Args<Arg>,
		map: async (arg) => arg,
		reduce: {},
	});
	const {
		enableOptimizations: enableOptimizations_,
		pythonVersion,
		requirements: requirementsArg,
	} = customOptions;

	// Determine the Python version to use.
	const versionKey = pythonVersion ?? defaultVersion;
	const pythonVersionString = versions[versionKey].version;

	const host = customOptions.host ?? std.triple.host();
	const build = customOptions.build ?? host;
	const os = std.triple.os(host);

	if (os === "darwin" && enableOptimizations_ === true) {
		throw new Error("enableOptimizations is not supported on macOS.");
	}
	const enableOptimizations = enableOptimizations_ ?? false;

	// Get individual artifacts for libraryPaths wrapping.
	const artifacts = await std.deps.artifacts(deps, {
		build,
		host,
		sdk: customOptions.sdk,
	});

	// Build configure args.
	const configureArgs: Array<string> = [];
	if (enableOptimizations) {
		configureArgs.push("--enable-optimizations");
	}

	const makeArgs: Array<string> = [];
	const envAdditions: std.env.EnvObject = {};
	if (os === "darwin") {
		envAdditions.MACOSX_DEPLOYMENT_TARGET = "15.2";
		configureArgs.push(
			"DYLD_FALLBACK_LIBRARY_PATH=$DYLD_FALLBACK_LIBRARY_PATH",
			"ax_cv_c_float_words_bigendian=no",
		);
		makeArgs.push(
			"RUNSHARED=DYLD_FALLBACK_LIBRARY_PATH=$DYLD_FALLBACK_LIBRARY_PATH",
		);
	}

	const arg = await std.autotools.arg(
		{
			source: await source(versionKey),
			deps,
			env: envAdditions,
			opt: "3",
			setRuntimeLibraryPath: true,
			phases: {
				configure: { args: configureArgs },
				build: { args: makeArgs },
				install: { args: makeArgs },
			},
		},
		...args,
	);

	const output = await std.autotools.build(arg);

	// The python interpreter does not itself depend on these libraries, but submodules do. As a result, they were not automatically added during compilation. Explicitly add all the required library paths to the interpreter wrapper.
	const libraryPaths = [
		artifacts.libffi,
		artifacts.mpdecimal,
		artifacts.openssl,
		artifacts.zlib,
		artifacts.zstd,
	]
		.filter((v): v is tg.Directory => v !== undefined)
		.map((dir) => dir.get("lib").then(tg.Directory.expect));

	const pythonInterpreter = await std.wrap(
		tg.symlink(tg`${output}/bin/python${versionString(pythonVersionString)}`),
		{
			env: { PYTHONHOME: output },
			libraryPaths,
		},
	);

	let python = wrapScripts(
		pythonInterpreter,
		undefined,
		output,
		pythonVersionString,
	);

	// When pip3 installs a python script it writes the absolute path of the python interpreter on the shebang line. We force it to be /usr/bin/env python3.
	python = tg.directory(python, {
		["bin/pip3"]: std.wrap(tg.File.expect(await output.get("bin/pip3")), {
			interpreter: pythonInterpreter,
			args: ["--python", pythonInterpreter],
		}),
	});

	python = tg.directory(python, {
		["bin/pip"]: tg.symlink("pip3"),
		["bin/python"]: tg.symlink("python3"),
		["bin/python3"]: tg.symlink(`python${versionString(pythonVersionString)}`),
		[`bin/python${versionString(pythonVersionString)}`]: pythonInterpreter,
	});

	if (requirementsArg) {
		const deps = requirements.install(python, requirementsArg);
		return tg.directory(python, deps);
	}

	return python;
};

export default self;

/** Internal: wrap a directory containing a /bin subdirectory with python scripts. */
export const wrapScripts = async (
	pythonInterpreter: tg.Symlink | tg.File,
	pythonPath: tg.Template.Arg,
	artifact: tg.Directory,
	pythonVersionStr?: string,
) => {
	const scripts = [];
	let interpreterId;
	if (pythonInterpreter instanceof tg.File) {
		interpreterId = pythonInterpreter.id;
	} else {
		const pythonInterpreterTarget = await pythonInterpreter.resolve();
		if (pythonInterpreterTarget instanceof tg.File) {
			interpreterId = pythonInterpreterTarget.id;
		}
	}

	const bin = tg.Directory.expect(await artifact.get("bin"));
	for await (const [filename, file] of bin) {
		if (file instanceof tg.File && (await file.executable())) {
			const metadata = await std.file.executableMetadata(file);
			if (isPythonScript(metadata, interpreterId, pythonVersionStr)) {
				scripts.push(filename);
			}
		}
	}

	for (const script of scripts) {
		const executable = (await bin.get(script)) as tg.File;
		artifact = await tg.directory(artifact, {
			[`bin/${script}`]: std.wrap(executable, {
				interpreter: pythonInterpreter,
				env: {
					PYTHONPATH: tg.Mutation.suffix(pythonPath, ":"),
				},
			}),
		});
	}

	return artifact;
};

const isPythonScript = (
	metadata: std.file.ExecutableMetadata,
	knownId?: string,
	pythonVersionStr?: string,
): boolean => {
	if (metadata.format === "shebang") {
		const interpreter = metadata.interpreter;
		const versionSuffix = pythonVersionStr
			? versionString(pythonVersionStr)
			: versionString();
		const recognizedNames = ["python3", "python", `python${versionSuffix}`];
		if (knownId !== undefined) {
			recognizedNames.push(knownId);
		}
		return recognizedNames.find((i) => interpreter.includes(i)) !== undefined;
	} else {
		return false;
	}
};

/** Wrap a Python virtual environment directory to make its scripts executable.
 *
 * This function takes a venv directory created with `python -m venv` and wraps
 * all the scripts in its bin/ directory so they can be executed properly. This
 * includes setting the correct interpreter and PYTHONHOME environment variable.
 */
export const wrapVenv = async (
	venvDir: tg.Directory,
	pythonVersionStr?: string,
): Promise<tg.Directory> => {
	const venvBin = await venvDir.get("bin").then(tg.Directory.expect);

	// Find the python interpreter in the venv.
	const versionSuffix = pythonVersionStr
		? versionString(pythonVersionStr)
		: versionString();
	const venvPythonInterpreter = await venvBin
		.get(`python${versionSuffix}`)
		.then(tg.File.expect);

	// Wrap all executable scripts in the venv's bin directory.
	let wrappedBin = await tg.directory();
	for await (const [name, artifact] of venvBin) {
		if (artifact instanceof tg.File && (await artifact.executable())) {
			const metadata = await std.file.executableMetadata(artifact);
			// If it is a shebang script, wrap it with the venv's python interpreter.
			if (metadata.format === "shebang") {
				wrappedBin = await tg.directory(wrappedBin, {
					[name]: std.wrap(artifact, {
						interpreter: venvPythonInterpreter,
						env: {
							PYTHONHOME: venvDir,
						},
					}),
				});
			} else {
				// Keep non-shebang files as-is.
				wrappedBin = await tg.directory(wrappedBin, {
					[name]: artifact,
				});
			}
		} else {
			// Keep non-executable files and symlinks as-is.
			wrappedBin = await tg.directory(wrappedBin, {
				[name]: artifact,
			});
		}
	}

	// Replace the venv's bin directory with the wrapped version.
	return tg.directory(venvDir, {
		bin: wrappedBin,
	});
};

export type BuildArg = {
	/** The machine this package will build on. */
	build?: string;

	/** Additi8onal environment to include. */
	env?: std.env.Arg;

	/** The machine this package produces binaries for. */
	host?: string;

	/** An optional pyproject.toml. */
	pyprojectToml?: tg.File;

	/** The source directory. */
	source: tg.Directory;

	/** Optional overides to the python environment. */
	python?: Arg;
};

export const build = async (...args: std.Args<BuildArg>) => {
	const {
		build: buildTriple_,
		env,
		host: host_,
		python: pythonArg,
		pyprojectToml: pyprojectToml_,
		source,
	} = await std.args.apply<BuildArg, BuildArg>({
		args,
		map: async (arg) => arg,
		reduce: { source: "set" },
	});
	const host = host_ ?? std.triple.host();
	const buildTriple = buildTriple_ ?? host;

	tg.assert(source, "Must specify a source directory.");

	// Read the pyproject.toml.
	let pyprojectTomlFile =
		pyprojectToml_ ?? (await source.get("pyproject.toml").then(tg.File.expect));
	tg.assert(pyprojectTomlFile !== undefined, "could not locate pyproject.toml");
	const pyprojectToml = tg.encoding.toml.decode(
		await pyprojectTomlFile.text(),
	) as PyProjectToml;

	// Add the source directory to the python environment.
	const name = pyprojectToml.project?.name.toLowerCase();
	if (!name) {
		throw new Error("Invalid pyproject.toml: missing 'project.name'.");
	}

	// Determine where the package source is located.
	// Try src/${name} first (PEP 517/518 src-layout), then fall back to ${name} (flat layout).
	let packageSourcePath: tg.Template.Arg;
	const srcLayoutPath = await source.tryGet(`src/${name}`);
	if (srcLayoutPath !== undefined) {
		packageSourcePath = await tg`${source}/src/${name}`;
	} else {
		const flatLayoutPath = await source.tryGet(name);
		if (flatLayoutPath === undefined) {
			throw new Error(
				`Could not locate package source at ${name} or src/${name}`,
			);
		}
		packageSourcePath = await tg`${source}/${name}`;
	}

	// Construct the python environment.
	const pythonArtifact = await tg.directory(
		self({ ...pythonArg, build: buildTriple, env, host }),
		{
			["lib/python3/site-packages"]: {
				[name]: tg.symlink(packageSourcePath),
			},
		},
	);

	// Create the bin directory by symlinking in the python artifacts.
	const pythonBins = tg.Directory.expect(await pythonArtifact.get("bin"));
	let binDir = tg.directory();
	for await (const [name, _] of pythonBins) {
		binDir = tg.directory({
			[name]: tg.symlink(tg`${pythonArtifact}/bin/${name}`),
		});
	}

	// Generate/wrap the scripts as necessary.
	const scripts = generateScripts(pythonArtifact, pyprojectToml);
	binDir = tg.directory(binDir, scripts);

	// Return the built artifact containing the python environment pointed to via symlinks and the wrapped bins.
	const output = tg.directory({
		bin: binDir,
		"lib/site-packages/python3": tg.symlink(
			tg`${pythonArtifact}/lib/python3/site-packages`,
		),
	});

	return output;
};

type PyProjectToml = {
	project?: {
		name: string;
		scripts: Record<string, string>;
		console_scripts?: Record<string, string>;
		"entry-points"?: Record<string, string>;
	};
};

/** Given a parsed pyproject.toml, generate a directory of scripts corresponding to the configuration's scripts, entry-points, or console_scripts configuration. */
export const generateScripts = (
	pythonArtifact: tg.Directory,
	pyproject?: PyProjectToml,
	pythonVersionStr?: string,
) => {
	// Make sure that there is a [project] field in the pyproject.toml.
	const project = pyproject?.project;
	if (!project) {
		throw new Error("Expected a project metadata table.");
	}

	// Collect the entrypoints.
	const entrypoints = project["entry-points"];
	const scripts = project.scripts;
	const consoleScripts = project.console_scripts;

	// Validate the pyproject.toml, which requires only one entry for entry-points, scripts, or console_scripts.
	if (
		(scripts && entrypoints) ||
		(scripts && consoleScripts) ||
		(entrypoints && consoleScripts)
	) {
		throw new Error("Conflicting fields in pyproject.toml.");
	}

	// Collect the targets that we're wrapping.
	const targets = entrypoints ?? scripts ?? consoleScripts ?? {};
	let bin = tg.directory();
	for (const [name, reference] of Object.entries(targets)) {
		// The syntax for an entrypoint is <import specifier>:<attribute>.
		const [object, attribute] = reference.split(":");
		tg.assert(object);
		tg.assert(attribute);

		// Generate a python script that will run.
		const script = tg.file`
			# Generated by tangram://python
			import sys
			from ${object} import ${attribute}
			sys.exit(${attribute}())`;

		// Wrap the script.
		const versionSuffix = pythonVersionStr
			? versionString(pythonVersionStr)
			: versionString();
		bin = tg.directory(bin, {
			[name]: std.wrap({
				executable: script,
				interpreter: tg.symlink(
					tg`${pythonArtifact}/bin/python${versionSuffix}`,
				),
				env: {
					PYTHONPATH: tg`${pythonArtifact}/lib/python3/site-packages`,
				},
			}),
		});
	}

	return bin;
};

/** Run tests for a specific Python version. */
const testVersion = async (pythonVersion?: keyof typeof versions) => {
	const versionKey = pythonVersion ?? defaultVersion;
	const versionInfo = versions[versionKey];
	console.log(`Testing Python ${versionInfo.version}...`);

	const pythonEnv = self({
		...(pythonVersion && { pythonVersion }),
	});

	const helloOutput =
		await $`set -x && python -c 'print("Hello, world!")' > ${tg.output}`
			.env(pythonEnv)
			.then(tg.File.expect)
			.then((f) => f.text())
			.then((t) => t.trim());
	tg.assert(
		helloOutput === "Hello, world!",
		`could not run a simple python script with version ${versionInfo.version}`,
	);

	const testImportZlibScript = tg.file`
try:
	import zlib
	print("zlib is successfully imported!")
	print(f"zlib version: {zlib.ZLIB_VERSION}")
except ImportError as e:
	print(f"Failed to import zlib: {str(e)}")`;
	const importZlibOutput =
		await $`set -x && python ${testImportZlibScript} > ${tg.output}`
			.env(pythonEnv)
			.then(tg.File.expect)
			.then((f) => f.text())
			.then((t) => t.trim());
	tg.assert(
		importZlibOutput.includes(zlib.metadata.version),
		`failed to import the zlib module with version ${versionInfo.version}`,
	);

	const pipVersionOutput = await $`set -x && pip3 --version > ${tg.output}`
		.env(pythonEnv)
		.then(tg.File.expect)
		.then((f) => f.text())
		.then((t) => t.trim());
	tg.assert(
		pipVersionOutput.includes("25.2"),
		`failed to run pip3 with version ${versionInfo.version}`,
	);

	let venv = await $`set -x && python -m venv ${tg.output} --copies`
		.env(pythonEnv)
		.then(tg.Directory.expect);
	console.log(`venv for Python ${versionInfo.version}:`, venv.id);

	// Wrap the venv to make its scripts executable.
	venv = await wrapVenv(venv, versionInfo.version);

	// Test that the venv actually works by running python from it.
	const venvPython = await venv.get("bin/python3").then(tg.File.expect);
	const venvHelloOutput =
		await $`set -x && ${venvPython} -c 'print("Hello from venv!")' > ${tg.output}`
			.then(tg.File.expect)
			.then((f) => f.text())
			.then((t) => t.trim());
	tg.assert(
		venvHelloOutput === "Hello from venv!",
		`venv python could not run a simple script with version ${versionInfo.version}`,
	);

	// Test that pip is available and executable in the venv.
	const venvPip = await venv.get("bin/pip3").then(tg.File.expect);
	const venvPipVersionOutput =
		await $`set -x && ${venvPip} --version > ${tg.output}`
			.then(tg.File.expect)
			.then((f) => f.text())
			.then((t) => t.trim());
	tg.assert(
		venvPipVersionOutput.includes("pip"),
		`venv pip could not run with version ${versionInfo.version}`,
	);

	// Test that the venv can import standard library modules.
	const testImportScript = tg.file`
		import sys
		import os
		print(f"Python version: {sys.version}")
		print(f"Executable: {sys.executable}")
		print("Standard library imports work!")`;
	const venvImportOutput =
		await $`set -x && ${venvPython} ${testImportScript} > ${tg.output}`
			.then(tg.File.expect)
			.then((f) => f.text())
			.then((t) => t.trim());
	tg.assert(
		venvImportOutput.includes("Standard library imports work!"),
		`venv could not import standard library modules with version ${versionInfo.version}`,
	);

	console.log(`✓ Python ${versionInfo.version} tests passed`);
	return true;
};

/** Test the default Python version. */
export const test = async () => {
	return await testVersion();
};

/** Test Python 3.13. */
export const test313 = async () => {
	return await testVersion("3.13");
};

/** Test Python 3.14. */
export const test314 = async () => {
	return await testVersion("3.14");
};
