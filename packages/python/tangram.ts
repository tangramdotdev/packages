import * as std from "std" with { local: "../std" };
import { $ } from "std" with { local: "../std" };

import * as bzip2 from "bzip2" with { local: "../bzip2" };
import * as libffi from "libffi" with { local: "../libffi" };
import * as libxcrypt from "libxcrypt" with { local: "../libxcrypt" };
import * as mpdecimal from "mpdecimal" with { local: "../mpdecimal" };
import * as ncurses from "ncurses" with { local: "../ncurses" };
import * as openssl from "openssl" with { local: "../openssl" };
import * as readline from "readline" with { local: "../readline" };
import * as sqlite from "sqlite" with { local: "../sqlite" };
import * as zlib from "zlib" with { local: "../zlib" };
import * as zstd from "zstd" with { local: "../zstd" };

import * as requirements from "./requirements.tg.ts";
export { requirements };

/** Package metadata for python */
export const metadata = {
	homepage: "https://www.python.org/",
	name: "python",
	license: "Python Software Foundation License",
	repository: "https://github.com/python/cpython",
	version: "3.14.0",
	tag: "python/3.14.0",
};

/** Return the MAJ.MIN version of python, used by some installation scripts. */
export const versionString = () => {
	const [maj, min, ..._] = metadata.version.split(".");
	return `${maj}.${min}`;
};

/** Return the source code for the python specified by `metadata`. */
export const source = async (): Promise<tg.Directory> => {
	const { version } = metadata;
	const checksum =
		"sha256:2299dae542d395ce3883aca00d3c910307cd68e0b2f7336098c8e7b7eee9f3e9";
	const extension = ".tar.xz";
	const base = `https://www.python.org/ftp/python/${version}`;
	const name = "Python";
	return await std.download
		.extractArchive({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = {
	/** Optional autotools configuration. */
	autotools?: std.autotools.Arg;

	/** Args for dependencies. */
	dependencies?: {
		bzip2?: std.args.DependencyArg<bzip2.Arg>;
		libffi?: std.args.DependencyArg<libffi.Arg>;
		libxcrypt?: std.args.DependencyArg<libxcrypt.Arg>;
		mpdecimal?: std.args.DependencyArg<mpdecimal.Arg>;
		ncurses?: std.args.DependencyArg<ncurses.Arg>;
		openssl?: std.args.DependencyArg<openssl.Arg>;
		readline?: std.args.DependencyArg<readline.Arg>;
		sqlite?: std.args.DependencyArg<sqlite.Arg>;
		zlib?: std.args.DependencyArg<zlib.Arg>;
		zstd?: std.args.DependencyArg<zstd.Arg>;
	};

	/** Optional environment variables to set. */
	env?: std.env.Arg;

	/** Optional set of requirements, either as a requirements.txt file or as a string passed to pip install.
	 *
	 * Hashes are required!
	 */
	requirements?: requirements.Arg;

	/** The system to build python upon. */
	build?: string;

	/** Build with --enable-optimizations? Not supported on macOS at the moment, enabled by default on Linux. */
	enableOptimizations?: boolean;

	/** The system to use python. Currently must be the same as build. */
	host?: string;

	/** Optional sdk args to use. */
	sdk?: std.sdk.Arg;

	/** Optional python source override. */
	source?: tg.Directory;
};

/** Build and create a python environment. */
export const self = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: dependencyArgs = {},
		enableOptimizations: enableOptimizations_,
		env: env_,
		host,
		requirements: requirementsArg,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const os = std.triple.os(host);

	if (os === "darwin" && enableOptimizations_ === true) {
		throw new Error("enableOptimizations is not supported on macOS.");
	}
	const enableOptimizations = enableOptimizations_ ?? false;

	const processDependency = (dep: any) =>
		std.env.envArgFromDependency(build, env_, host, sdk, dep);

	const dependencies = [
		std.env.runtimeDependency(bzip2.build, dependencyArgs.bzip2),
		std.env.runtimeDependency(libxcrypt.build, dependencyArgs.libxcrypt),
		std.env.runtimeDependency(ncurses.build, dependencyArgs.ncurses),
		std.env.runtimeDependency(readline.build, dependencyArgs.readline),
		std.env.runtimeDependency(sqlite.build, dependencyArgs.sqlite),
	];

	// Set up additional runtime dependencies that will end up in the wrapper.
	const libffiForHost = await processDependency(
		std.env.runtimeDependency(libffi.build, dependencyArgs.libffi),
	);
	const mpdecimalForHost = await processDependency(
		std.env.runtimeDependency(mpdecimal.build, dependencyArgs.mpdecimal),
	);
	const opensslForHost = await processDependency(
		std.env.runtimeDependency(openssl.build, dependencyArgs.openssl),
	);
	const zlibForHost = await processDependency(
		std.env.runtimeDependency(zlib.build, dependencyArgs.zlib),
	);
	const zstdForHost = await processDependency(
		std.env.runtimeDependency(zstd.build, dependencyArgs.zstd),
	);
	let hostLibDirs = [
		libffiForHost,
		mpdecimalForHost,
		opensslForHost,
		zlibForHost,
		zstdForHost,
	];

	// Resolve env.
	const envs: Array<tg.Unresolved<std.env.Arg>> = [
		...dependencies.map(processDependency),
		...hostLibDirs,
	];
	const configureArgs = [];
	if (enableOptimizations) {
		configureArgs.push("--enable-optimizations");
	}

	const makeArgs = [];
	if (os === "darwin") {
		envs.push({ MACOSX_DEPLOYMENT_TARGET: "15.2" });
		configureArgs.push(
			"DYLD_FALLBACK_LIBRARY_PATH=$DYLD_FALLBACK_LIBRARY_PATH",
			"ax_cv_c_float_words_bigendian=no",
		);
		makeArgs.push(
			"RUNSHARED=DYLD_FALLBACK_LIBRARY_PATH=$DYLD_FALLBACK_LIBRARY_PATH",
		);
	}
	const env = std.env.arg(...envs, env_);

	const configure = { args: configureArgs };
	const buildPhase = { args: makeArgs };
	const install = { args: makeArgs };
	const phases = { configure, build: buildPhase, install };

	const output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
			opt: "3",
			sdk,
			setRuntimeLibraryPath: true,
			source: source_ ?? (await source()),
		},
		autotools,
	);

	// The python interpreter does not itself depend on these libraries, but submodules do. As a result, they were not automatically added during compilation. Explicitly add all the required library paths to the interpreter wrapper.
	const libraryPaths = [
		libffiForHost,
		mpdecimalForHost,
		opensslForHost,
		zlibForHost,
		zstdForHost,
	]
		.filter((v) => v !== undefined)
		.map((dir) => dir.get("lib").then(tg.Directory.expect));

	const pythonInterpreter = await std.wrap(
		tg.symlink(tg`${output}/bin/python${versionString()}`),
		{
			env: { PYTHONHOME: output },
			libraryPaths,
		},
	);

	let python = wrapScripts(pythonInterpreter, undefined, output);

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
		["bin/python3"]: tg.symlink(`python${versionString()}`),
		[`bin/python${versionString()}`]: pythonInterpreter,
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
			if (isPythonScript(metadata, interpreterId)) {
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
): boolean => {
	if (metadata.format === "shebang") {
		const interpreter = metadata.interpreter;
		const recognizedNames = ["python3", "python", `python${versionString}`];
		if (knownId !== undefined) {
			recognizedNames.push(knownId);
		}
		return recognizedNames.find((i) => interpreter.includes(i)) !== undefined;
	} else {
		return false;
	}
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
	const host = host_ ?? (await std.triple.host());
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
		bin = tg.directory(bin, {
			[name]: std.wrap({
				executable: script,
				interpreter: tg.symlink(
					tg`${pythonArtifact}/bin/python${versionString()}`,
				),
				env: {
					PYTHONPATH: tg`${pythonArtifact}/lib/python3/site-packages`,
				},
			}),
		});
	}

	return bin;
};

export const test = async () => {
	const helloOutput =
		await $`set -x && python -c 'print("Hello, world!")' > $OUTPUT`
			.env(self())
			.then(tg.File.expect)
			.then((f) => f.text())
			.then((t) => t.trim());
	tg.assert(
		helloOutput === "Hello, world!",
		"could not run a simple python script",
	);

	const testImportZlibScript = tg.file`
try:
	import zlib
	print("zlib is successfully imported!")
	print(f"zlib version: {zlib.ZLIB_VERSION}")
except ImportError as e:
	print(f"Failed to import zlib: {str(e)}")`;
	const importZlibOutput =
		await $`set -x && python ${testImportZlibScript} > $OUTPUT`
			.env(self())
			.then(tg.File.expect)
			.then((f) => f.text())
			.then((t) => t.trim());
	tg.assert(
		importZlibOutput.includes(zlib.metadata.version),
		"failed to import the zlib module",
	);

	const pipVersionOutput = await $`set -x && pip3 --version > $OUTPUT`
		.env(self())
		.then(tg.File.expect)
		.then((f) => f.text())
		.then((t) => t.trim());
	tg.assert(pipVersionOutput.includes("25.2"), "failed to run pip3");

	const venv = await $`set -x && python -m venv $OUTPUT --copies`
		.env(self())
		.then(tg.Directory.expect);
	console.log("venv", venv.id);

	return true;
};
