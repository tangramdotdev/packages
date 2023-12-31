import * as std from "tg:std" with { path: "../std" };

import bzip2 from "tg:bzip2" with { path: "../bzip2" };
import libffi from "tg:libffi" with { path: "../libffi" };
import openssl from "tg:openssl" with { path: "../openssl" };
import sqlite from "tg:sqlite" with { path: "../sqlite" };
import zlib from "tg:zlib" with { path: "../zlib" };

import * as requirements from "./requirements.tg.ts";
export { requirements };

/** Package metadata for python */
export let metadata = {
	name: "Python",
	version: "3.12.1",
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
		"sha256:8dfb8f426fcd226657f9e2bd5f1e96e53264965176fa17d32658e873591aeb21";
	let unpackFormat = ".tar.xz" as const;
	let url = `https://www.python.org/ftp/python/${version}/${name}-${version}${unpackFormat}`;

	let download = tg.Directory.expect(
		await std.download({
			checksum,
			unpackFormat,
			url,
		}),
	);

	return std.directory.unwrap(download);
});

type ToolchainArg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;

	/** Optional python source override. */
	source?: tg.Directory;

	/** Optional set of requirements, either as a requirements.txt file or as a string passed to pip install.
	 *
	 * Hashes are required!
	 */
	requirements?: requirements.Arg;

	/** The system to build python upon. */
	build?: std.Triple.Arg;

	/** The system to use python. Currently must be the same as build. */
	host?: std.Triple.Arg;

	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
};

/** Build and create a python environment. */
export let python = tg.target(async (arg?: ToolchainArg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	let env = [
		bzip2({ host }),
		libffi({ host }),
		openssl({ host }),
		sqlite({ host }),
		zlib({ host }),
		{
			LDFLAGS: tg.Mutation.templateAppend("-lgcov --coverage", " "),
		},
	];

	let configure = {
		args: [
			"--disable-test-modules",
			"--enable-optimizations",
			"--with-pkg-config=yes",
			"--without-c-locale-coercion",
		],
	};

	let phases = { configure };

	let output = await std.autotools.build(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
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
	build?: std.Triple.Arg;
	host?: std.Triple.Arg;

	/** An optional pyproject.toml. */
	pyprojectToml?: tg.File;

	/** The source directory. */
	source: tg.Directory;

	/** If set, the source directory will be installed as a source distribution via pip. */
	// sdist?: boolean, TODO

	/** Optional overides to the python environment. */
	python?: ToolchainArg;
};

export let build = async (...args: tg.Args<Arg>) => {
	type Apply = {
		buildTriple?: std.Triple.Arg;
		host?: std.Triple.Arg;
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
	let host = host_ ? std.triple(host_) : await std.Triple.host();
	let buildTriple = buildTriple_ ? std.triple(buildTriple_) : host;

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
				// TODO: verify this convention is strong enough to use.
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
	// TODO: gui_scripts?
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
		// TODO: parse full syntax for entry point specifiers, including groups.
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
