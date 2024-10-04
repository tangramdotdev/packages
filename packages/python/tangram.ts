import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

import * as bison from "bison" with { path: "../bison" };
import * as bzip2 from "bzip2" with { path: "../bzip2" };
import * as libffi from "libffi" with { path: "../libffi" };
import * as libxcrypt from "libxcrypt" with { path: "../libxcrypt" };
import * as m4 from "m4" with { path: "../m4" };
import * as ncurses from "ncurses" with { path: "../ncurses" };
import * as openssl from "openssl" with { path: "../openssl" };
import * as pkgconfig from "pkgconfig" with { path: "../pkgconfig" };
import * as readline from "readline" with { path: "../readline" };
import * as sqlite from "sqlite" with { path: "../sqlite" };
import * as zlib from "zlib" with { path: "../zlib" };

import * as requirements from "./requirements.tg.ts";
export { requirements };

/** Package metadata for python */
export const metadata = {
	homepage: "https://www.python.org/",
	name: "Python",
	license: "Python Software Foundation License",
	repository: "https://github.com/python/cpython",
	version: "3.12.7",
};

/** Return the MAJ.MIN version of python, used by some installation scripts. */
export const versionString = () => {
	const [maj, min, ..._] = metadata.version.split(".");
	return `${maj}.${min}`;
};

/** Return the source code for the python specified by `metadata`. */
export const source = tg.target(async (): Promise<tg.Directory> => {
	const { name, version } = metadata;
	const checksum =
		"sha256:24887b92e2afd4a2ac602419ad4b596372f67ac9b077190f459aba390faf5550";
	const extension = ".tar.xz";
	const base = `https://www.python.org/ftp/python/${version}`;
	return await std
		.download({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	/** Optional autotools configuration. */
	autotools?: std.autotools.Arg;

	/** Args for dependencies. */
	dependencies?: {
		bzip2?: bzip2.Arg;
		libffi?: libffi.Arg;
		libxcrypt?: libxcrypt.Arg;
		ncurses?: ncurses.Arg;
		openssl?: openssl.Arg;
		readline?: readline.Arg;
		sqlite?: sqlite.Arg;
		zlib?: zlib.Arg;
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

	/** The system to use python. Currently must be the same as build. */
	host?: string;

	/** Optional sdk args to use. */
	sdk?: std.sdk.Arg;

	/** Optional python source override. */
	source?: tg.Directory;
};

/** Build and create a python environment. */
export const toolchain = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: {
			bzip2: bzip2Arg = {},
			libffi: libffiArg = {},
			libxcrypt: libxcryptArg = {},
			ncurses: ncursesArg = {},
			openssl: opensslArg = {},
			readline: readlineArg = {},
			sqlite: sqliteArg = {},
			zlib: zlibArg = {},
		} = {},
		env: env_,
		host,
		requirements: requirementsArg,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const os = std.triple.os(host);

	// Set up build dependencies.
	const buildDependencies = [];
	const bisonForBuild = bison.build({ build, host: build }).then((d) => {
		return { BISON: std.directory.keepSubdirectories(d, "bin") };
	});
	buildDependencies.push(bisonForBuild);
	const m4ForBuild = m4.build({ build, host: build }).then((d) => {
		return { M4: std.directory.keepSubdirectories(d, "bin") };
	});
	buildDependencies.push(m4ForBuild);
	const pkgConfigForBuild = pkgconfig
		.build({ build, host: build })
		.then((d) => {
			return { PKGCONFIG: std.directory.keepSubdirectories(d, "bin") };
		});
	buildDependencies.push(pkgConfigForBuild);

	// Set yup host dependencies.
	const hostDependencies = [];
	const bzip2ForHost = await bzip2
		.build({ build, host, sdk }, bzip2Arg)
		.then((d) => std.directory.keepSubdirectories(d, "include", "lib"));
	hostDependencies.push(bzip2ForHost);
	const libffiForHost = await libffi
		.build({ build, host, sdk }, libffiArg)
		.then((d) => std.directory.keepSubdirectories(d, "include", "lib"));
	hostDependencies.push(libffiForHost);
	const libxcryptForHost = await libxcrypt
		.build({ build, host, sdk }, libxcryptArg)
		.then((d) => std.directory.keepSubdirectories(d, "include", "lib"));
	hostDependencies.push(libxcryptForHost);
	const ncursesForHost = await ncurses
		.build({ build, host, sdk }, ncursesArg)
		.then((d) => std.directory.keepSubdirectories(d, "include", "lib"));
	hostDependencies.push(ncursesForHost);
	const opensslForHost = await openssl
		.build({ build, host, sdk }, opensslArg)
		.then((d) => std.directory.keepSubdirectories(d, "include", "lib"));
	hostDependencies.push(opensslForHost);
	const readlineForHost = await readline
		.build({ build, host, sdk }, readlineArg)
		.then((d) => std.directory.keepSubdirectories(d, "include", "lib"));
	hostDependencies.push(readlineForHost);
	const sqliteForHost = await sqlite
		.build({ build, host, sdk }, sqliteArg)
		.then((d) => std.directory.keepSubdirectories(d, "include", "lib"));
	hostDependencies.push(sqliteForHost);
	const zlibForHost = await zlib
		.build({ build, host, sdk }, zlibArg)
		.then((d) => std.directory.keepSubdirectories(d, "include", "lib"));
	hostDependencies.push(zlibForHost);

	// Resolve env.
	const resolvedEnv = await std.env.arg(
		...buildDependencies,
		...hostDependencies,
		env_,
	);

	// Add final build dependencies to env.
	const resolvedBuildDependencies = [];
	const finalBison = await std.env.getArtifactByKey({
		env: resolvedEnv,
		key: "BISON",
	});
	resolvedBuildDependencies.push(finalBison);
	const finalM4 = await std.env.getArtifactByKey({
		env: resolvedEnv,
		key: "M4",
	});
	resolvedBuildDependencies.push(finalM4);
	const finalPkgConfig = await std.env.getArtifactByKey({
		env: resolvedEnv,
		key: "PKGCONFIG",
	});
	resolvedBuildDependencies.push(finalPkgConfig);
	const env: tg.Unresolved<Array<std.env.Arg>> = [
		resolvedEnv,
		...resolvedBuildDependencies,
	];

	if (os === "darwin") {
		env.push({ MACOSX_DEPLOYMENT_TARGET: "15.0" });
	}

	const configure = {
		args: [],
	};

	// Enable PGO on macOS and Linux only if the LLVM toolchain is not used.
	if (
		std.triple.os(build) === "darwin" ||
		((await std.env.tryWhich({ env: env_, name: "clang" })) === undefined &&
			std.flatten(sdk ?? []).filter((sdk) => sdk?.toolchain === "llvm")
				.length === 0)
	) {
		configure.args.push("--enable-optimizations");
	}

	const phases = { configure };

	const output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(env),
			opt: "3",
			phases,
			sdk,
			setRuntimeLibraryPath: true,
			source: source_ ?? (await source()),
		},
		autotools,
	);

	const pythonInterpreter = await std.wrap(
		tg.symlink(tg`${output}/bin/python${versionString()}`),
		{
			env: {
				PYTHONHOME: tg`${output}`,
			},
		},
	);

	let python = wrapScripts(pythonInterpreter, undefined, output);

	// When pip3 installs a python script it writes the absolute path of the python interpreter on the shebang line. We force it to be /usr/bin/env python3.
	python = tg.directory(python, {
		["bin/pip3"]: std.wrap(tg.File.expect(await output.get("bin/pip3")), {
			interpreter: tg.symlink(tg`${output}/bin/python3.12`),
			args: ["--python", tg`${output}/bin/python3.12`],
		}),
	});

	python = tg.directory(python, {
		["bin/pip"]: tg.symlink("pip3"),
		["bin/python"]: tg.symlink("python3"),
		["bin/python3"]: tg.symlink("python3.12"),
		["bin/python3.12"]: pythonInterpreter,
	});

	if (requirementsArg) {
		const deps = requirements.install(python, requirementsArg);
		return tg.directory(python, deps);
	}

	return python;
});

export default toolchain;

/** Internal: wrap a directory containing a /bin subdirectory with python scripts. */
export const wrapScripts = async (
	pythonInterpreter: tg.Symlink | tg.File,
	pythonPath: tg.Template.Arg,
	artifact: tg.Directory,
) => {
	const scripts = [];

	const bin = tg.Directory.expect(await artifact.get("bin"));
	for await (const [filename, file] of bin) {
		if (file instanceof tg.File && (await file.executable())) {
			const metadata = await std.file.executableMetadata(file);
			if (isPythonScript(metadata)) {
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

const isPythonScript = (metadata: std.file.ExecutableMetadata): boolean => {
	if (metadata.format === "shebang") {
		const interpreter = metadata.interpreter;
		return (
			["python3", "python", `python${versionString}`].find((i) =>
				interpreter.includes(i),
			) !== undefined
		);
	} else {
		return false;
	}
};

export type BuildArg = {
	/** The machine this package will build on. */
	build?: string;

	/** The machine this package produces binaries for. */
	host?: string;

	/** An optional pyproject.toml. */
	pyprojectToml?: tg.File;

	/** The source directory. */
	source: tg.Directory;

	/** Optional overides to the python environment. */
	python?: Arg;
};

export const build = tg.target(async (...args: std.Args<BuildArg>) => {
	const mutationArgs = await std.args.createMutations<BuildArg>(
		std.flatten(args),
	);
	const {
		build: buildTriple_,
		host: host_,
		python: pythonArg,
		pyprojectToml: pyprojectToml_,
		source,
	} = await std.args.applyMutations(mutationArgs);
	const host = host_ ?? (await std.triple.host());
	const buildTriple = buildTriple_ ?? host;

	tg.assert(source, "Must specify a source directory.");

	// Read the pyproject.toml.
	let pyprojectToml;
	if (pyprojectToml_) {
		pyprojectToml = tg.encoding.toml.decode(
			await pyprojectToml_.text(),
		) as PyProjectToml;
	}

	// Add the source directory to the python environment.
	const name = pyprojectToml?.project?.name;
	if (!name) {
		throw new Error("Invalid pyproject.toml: missing 'project.name'.");
	}

	// Construct the python environment.
	const pythonArtifact = await tg.directory(
		toolchain({ ...pythonArg, build: buildTriple, host }),
		{
			["lib/python3/site-packages"]: {
				[name]: tg.symlink(tg`${source}/${name}`),
			},
		},
	);

	// Create the bin directory by symlinking in the python artifacts.
	const pythonBins = tg.Directory.expect(await pythonArtifact.get("bin"));
	let binDir = tg.directory({});
	for await (const [name, _] of pythonBins) {
		binDir = tg.directory({
			[name]: tg.symlink(`${pythonArtifact}/bin/${name}`),
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
});

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

		// Generate a python script that will run.
		const script = tg.file(`
# Generated by tangram://python
import sys
from ${object} import ${attribute}
sys.exit(${attribute}())
`);

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

export const test = tg.target(async () => {
	return await $`
				set -e

				echo "Checking that we can run python scripts."
				python -I -c 'print("Hello, world!")'

				echo "Checking that we can run pip."
				pip3 --version

				echo "Checking that we can create virtual envs."
				python -m venv $OUTPUT || true
			`.env(toolchain());
});
