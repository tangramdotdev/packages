import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };

import * as bison from "tg:bison" with { path: "../bison" };
import * as bzip2 from "tg:bzip2" with { path: "../bzip2" };
import * as libffi from "tg:libffi" with { path: "../libffi" };
import * as libxcrypt from "tg:libxcrypt" with { path: "../libxcrypt" };
import * as m4 from "tg:m4" with { path: "../m4" };
import * as ncurses from "tg:ncurses" with { path: "../ncurses" };
import * as openssl from "tg:openssl" with { path: "../openssl" };
import * as pkgconfig from "tg:pkg-config" with { path: "../pkgconfig" };
import * as readline from "tg:readline" with { path: "../readline" };
import * as sqlite from "tg:sqlite" with { path: "../sqlite" };
import * as zlib from "tg:zlib" with { path: "../zlib" };

import * as requirements from "./requirements.tg.ts";
export { requirements };

/** Package metadata for python */
export let metadata = {
	homepage: "https://www.python.org/",
	name: "Python",
	license: "Python Software Foundation License",
	repository: "https://github.com/python/cpython",
	version: "3.12.4",
};

/** Return the MAJ.MIN version of python, used by some installation scripts. */
export let versionString = () => {
	let [maj, min, ..._] = metadata.version.split(".");
	return `${maj}.${min}`;
};

/** Return the source code for the python specified by `metadata`. */
export let source = tg.target(async (): Promise<tg.Directory> => {
	let { name, version } = metadata;
	let checksum =
		"sha256:f6d419a6d8743ab26700801b4908d26d97e8b986e14f95de31b32de2b0e79554";
	let extension = ".tar.xz";
	let packageArchive = std.download.packageArchive({
		name,
		version,
		extension,
	});
	let url = `https://www.python.org/ftp/python/${version}/${packageArchive}`;
	return await std
		.download({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	/** Optional autotools configuration. */
	autotools?: std.autotools.Arg;

	/** Args for dependencies. */
	dependencies?: {
		bison?: bison.Arg;
		bzip2?: bzip2.Arg;
		libffi?: libffi.Arg;
		libxcrypt?: libxcrypt.Arg;
		m4?: m4.Arg;
		ncurses?: ncurses.Arg;
		openssl?: openssl.Arg;
		pkgconfig?: pkgconfig.Arg;
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
export let toolchain = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		dependencies: {
			bison: bisonArg = {},
			bzip2: bzip2Arg = {},
			libffi: libffiArg = {},
			libxcrypt: libxcryptArg = {},
			m4: m4Arg = {},
			ncurses: ncursesArg = {},
			openssl: opensslArg = {},
			pkgconfig: pkgconfigArg = {},
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

	let os = std.triple.os(host);

	let dependencies = [
		bison.build({ build, host: build }, bisonArg),
		bzip2.build({ build, env: env_, host, sdk }, bzip2Arg),
		libffi.build({ build, env: env_, host, sdk }, libffiArg),
		libxcrypt.build({ build, env: env_, host, sdk }, libxcryptArg),
		m4.build({ build, host: build }, m4Arg),
		ncurses.build({ build, env: env_, host, sdk }, ncursesArg),
		openssl.build({ build, env: env_, host, sdk }, opensslArg),
		pkgconfig.build({ build, host: build }, pkgconfigArg),
		readline.build({ build, env: env_, host, sdk }, readlineArg),
		sqlite.build({ build, env: env_, host, sdk }, sqliteArg),
		zlib.build({ build, env: env_, host, sdk }, zlibArg),
	];
	let env = [...dependencies, env_];
	if (os === "darwin") {
		env.push({ MACOSX_DEPLOYMENT_TARGET: "14.5" });
	}

	let configure = {
		args: ["--with-pkg-config=yes", "--without-c-locale-coercion"],
	};

	// Enable PGO on macOS and Linux only if the LLVm toolchain is not used.
	if (
		std.triple.os(build) === "darwin" ||
		((await std.env.tryWhich({ env: env_, name: "clang" })) === undefined &&
			std.flatten(sdk ?? []).filter((sdk) => sdk?.toolchain === "llvm")
				.length === 0)
	) {
		configure.args.push("--enable-optimizations");
	}

	// Allow loading libraries from the compile-time library path.
	let runtimeLibraryEnvVar =
		os === "darwin" ? "DYLD_FALLBACK_LIBRARY_PATH" : "LD_LIBRARY_PATH";
	let prepare = `export ${runtimeLibraryEnvVar}=$LIBRARY_PATH`;

	let phases = { prepare, configure };

	let output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(env),
			opt: "3",
			phases,
			sdk,
			source: source_ ?? (await source()),
		},
		autotools,
	);

	let pythonInterpreter = await std.wrap(
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
		let deps = requirements.install(python, requirementsArg);
		return tg.directory(python, deps);
	}

	return python;
});

export default toolchain;

/** Internal: wrap a directory containing a /bin subdirectory with python scripts. */
export let wrapScripts = async (
	pythonInterpreter: tg.Symlink | tg.File,
	pythonPath: tg.Template.Arg,
	artifact: tg.Directory,
) => {
	let scripts = [];

	let bin = tg.Directory.expect(await artifact.get("bin"));
	for await (let [filename, file] of bin) {
		if (file instanceof tg.File && (await file.executable())) {
			let metadata = await std.file.executableMetadata(file);
			if (isPythonScript(metadata)) {
				scripts.push(filename);
			}
		}
	}

	for (let script of scripts) {
		let executable = (await bin.get(script)) as tg.File;
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

let isPythonScript = (metadata: std.file.ExecutableMetadata): boolean => {
	if (metadata.format === "shebang") {
		let interpreter = metadata.interpreter;
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

export let build = tg.target(async (...args: std.Args<BuildArg>) => {
	let mutationArgs = await std.args.createMutations<BuildArg>(
		std.flatten(args),
	);
	let {
		build: buildTriple_,
		host: host_,
		python: pythonArg,
		pyprojectToml: pyprojectToml_,
		source,
	} = await std.args.applyMutations(mutationArgs);
	let host = host_ ?? (await std.triple.host());
	let buildTriple = buildTriple_ ?? host;

	tg.assert(source, "Must specify a source directory.");

	// Read the pyproject.toml.
	let pyprojectToml;
	if (pyprojectToml_) {
		pyprojectToml = tg.encoding.toml.decode(
			await pyprojectToml_.text(),
		) as PyProjectToml;
	}

	// Add the source directory to the python environment.
	let name = pyprojectToml?.project?.name;
	if (!name) {
		throw new Error("Invalid pyproject.toml: missing 'project.name'.");
	}

	// Construct the python environment.
	let pythonArtifact = await tg.directory(
		toolchain({ ...pythonArg, build: buildTriple, host }),
		{
			["lib/python3/site-packages"]: {
				[name]: tg.symlink(tg`${source}/${name}`),
			},
		},
	);

	// Create the bin directory by symlinking in the python artifacts.
	let pythonBins = tg.Directory.expect(await pythonArtifact.get("bin"));
	let binDir = tg.directory({});
	for await (let [name, _] of pythonBins) {
		binDir = tg.directory({
			[name]: tg.symlink(`${pythonArtifact}/bin/${name}`),
		});
	}

	// Generate/wrap the scripts as necessary.
	let scripts = generateScripts(pythonArtifact, pyprojectToml);
	binDir = tg.directory(binDir, scripts);

	// Return the built artifact containing the python environment pointed to via symlinks and the wrapped bins.
	let output = tg.directory({
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
export let generateScripts = (
	pythonArtifact: tg.Directory,
	pyproject?: PyProjectToml,
) => {
	// Make sure that there is a [project] field in the pyproject.toml.
	let project = pyproject?.project;
	if (!project) {
		throw new Error("Expected a project metadata table.");
	}

	// Collect the entrypoints.
	let entrypoints = project["entry-points"];
	let scripts = project.scripts;
	let consoleScripts = project.console_scripts;

	// Validate the pyproject.toml, which requires only one entry for entry-points, scripts, or console_scripts.
	if (
		(scripts && entrypoints) ||
		(scripts && consoleScripts) ||
		(entrypoints && consoleScripts)
	) {
		throw new Error("Conflicting fields in pyproject.toml.");
	}

	// Collect the targets that we're wrapping.
	let targets = entrypoints ?? scripts ?? consoleScripts ?? {};
	let bin = tg.directory();
	for (let [name, reference] of Object.entries(targets)) {
		// The syntax for an entrypoint is <import specifier>:<attribute>.
		let [object, attribute] = reference.split(":");

		// Generate a python script that will run.
		let script = tg.file(`
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

export let test = tg.target(async () => {
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
