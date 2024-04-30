import * as std from "tg:std" with { path: "../std" };

import bison from "tg:bison" with { path: "../bison" };
import bzip2 from "tg:bzip2" with { path: "../bzip2" };
import libffi from "tg:libffi" with { path: "../libffi" };
import libxcrypt from "tg:libxcrypt" with { path: "../libxcrypt" };
import m4 from "tg:m4" with { path: "../m4" };
import ncurses from "tg:ncurses" with { path: "../ncurses" };
import openssl from "tg:openssl" with { path: "../openssl" };
import pkgconfig from "tg:pkgconfig" with { path: "../pkgconfig" };
import readline from "tg:readline" with { path: "../readline" };
import sqlite from "tg:sqlite" with { path: "../sqlite" };
import zlib from "tg:zlib" with { path: "../zlib" };

import * as requirements from "./requirements.tg.ts";
export { requirements };

/** Package metadata for python */
export let metadata = {
	homepage: "https://www.python.org/",
	name: "Python",
	license: "Python Software Foundation License",
	repository: "https://github.com/python/cpython",
	version: "3.12.3",
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
		"sha256:56bfef1fdfc1221ce6720e43a661e3eb41785dd914ce99698d8c7896af4bdaa1";
	let extension = ".tar.xz";
	let packageArchive = std.download.packageArchive({
		name,
		version,
		extension,
	});
	let url = `https://www.python.org/ftp/python/${version}/${packageArchive}`;
	let download = tg.Directory.expect(await std.download({ checksum, url }));
	let source = await std.directory.unwrap(download);
	let macOsVersionPatch = tg.File.expect(
		await tg.include("macos_platform_version.patch"),
	);
	source = await std.patch(source, macOsVersionPatch);
	return source;
});

type ToolchainArg = {
	/** Optional autotools configuration. */
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;

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
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;

	/** Optional python source override. */
	source?: tg.Directory;
};

/** Build and create a python environment. */
export let python = tg.target(async (arg?: ToolchainArg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;
	let os = std.triple.os(host);

	let dependencies = [
		bison({ ...rest, build, env: env_, host }),
		bzip2({ ...rest, build, env: env_, host }),
		libffi({ ...rest, build, env: env_, host }),
		libxcrypt({ ...rest, build, env: env_, host }),
		m4({ ...rest, build, env: env_, host }),
		ncurses({ ...rest, build, env: env_, host }),
		openssl({ ...rest, build, env: env_, host }),
		pkgconfig({ ...rest, build, env: env_, host }),
		readline({ ...rest, build, env: env_, host }),
		sqlite({ ...rest, build, env: env_, host }),
		zlib({ ...rest, build, env: env_, host }),
	];
	let env = [
		...dependencies,
		{
			TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: "resolve",
		},
		env_,
	];
	if (os === "darwin") {
		env.push({ MACOSX_DEPLOYMENT_TARGET: "14.4" });
	}

	let configure = {
		args: [
			"--disable-test-modules",
			"--with-pkg-config=yes",
			"--without-c-locale-coercion",
		],
	};

	// Enable PGO on macOS and Linux only if the LLVm toolchain is not used.
	if (
		std.triple.os(build) === "darwin" ||
		((await std.env.tryWhich({ env: env_, name: "clang" })) === undefined &&
			std.flatten(rest.sdk ?? []).filter((sdk) => sdk?.toolchain === "llvm")
				.length === 0)
	) {
		configure.args.push("--enable-optimizations");
	}

	let phases = { configure };

	let output = await std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases,
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

	if (arg?.requirements) {
		let deps = requirements.install(python, arg.requirements);
		return tg.directory(python, deps);
	}

	return python;
});

export default python;

/** Internal: wrap a directory containing a /bin subdirectory with python scripts. */
export let wrapScripts = async (
	pythonInterpreter: tg.Symlink | tg.File,
	pythonPath: tg.Template.Arg,
	artifact: tg.Directory,
) => {
	let scripts = [];

	let bin = tg.Directory.expect(await artifact.get("bin"));
	for await (let [filename, file] of bin) {
		if (tg.File.is(file) && (await file.executable())) {
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
					PYTHONPATH: tg.Mutation.templateAppend(pythonPath, ":"),
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

export type Arg = {
	/** The machine this package will build on. */
	build?: string;

	/** The machine this package produces binaries for. */
	host?: string;

	/** An optional pyproject.toml. */
	pyprojectToml?: tg.File;

	/** The source directory. */
	source: tg.Directory;

	/** Optional overides to the python environment. */
	python?: ToolchainArg;
};

export let build = async (...args: tg.Args<Arg>) => {
	type Apply = {
		buildTriple?: string;
		host?: string;
		pythonArg?: Array<ToolchainArg>;
		pyprojectToml: tg.File;
		source: tg.Directory;
	};
	let {
		buildTriple: buildTriple_,
		host: host_,
		pythonArg,
		pyprojectToml: pyprojectToml_,
		source,
	} = await tg.Args.apply<Arg, Apply>(args, async (arg) => {
		if (arg === undefined) {
			return {};
		} else {
			let object: tg.MutationMap<Apply> = {};
			if (arg.build) {
				object.buildTriple = arg.build;
			}
			if (arg.host) {
				object.host = arg.host;
			}
			if (arg.python) {
				object.pythonArg = tg.Mutation.is(arg.python)
					? arg.python
					: await tg.Mutation.arrayAppend(arg.python);
			}
			if (arg.pyprojectToml) {
				object.pyprojectToml = arg.pyprojectToml;
			}
			if (arg.source) {
				object.source = arg.source;
			}
			return object;
		}
	});
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
		python({ ...pythonArg, build: buildTriple, host }),
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
	return std.build(
		tg`
				set -e

				echo "Checking that we can run python scripts."
				python -I -c 'print("Hello, world!")'

				echo "Checking that we can run pip."
				pip3 --version

				echo "Checking that we can create virtual envs."
				python -m venv $OUTPUT || true
			`,
		{ env: python() },
	);
});
