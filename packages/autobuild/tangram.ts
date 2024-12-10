import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

import autoconf from "autoconf" with { path: "../autoconf" };
import automake from "automake" with { path: "../automake" };

import * as autotools from "./autotools";
import * as cc from "./cc";
import * as cmake from "./cmake";
import * as go from "./go";
import * as js from "./js";
import * as python from "./python";
import * as ruby from "./ruby";
import * as rust from "./rust";
import * as ts from "./ts";

// FIXME - why can't I just do tests and use .get()?
// import tests from "./tests" with { type: "directory" };
import ccAutotoolsTest from "./tests/cc-autotools" with { type: "directory" };
import cPlainTest from "./tests/c-plain" with { type: "directory" };
import cxxPlainTest from "./tests/cxx-plain" with { type: "directory" };
import fortranPlainTest from "./tests/fortran-plain" with { type: "directory" };
import cmakeTest from "./tests/cmake" with { type: "directory" };
import goTest from "./tests/go" with { type: "directory" };
import jsNodeTest from "./tests/js-node" with { type: "directory" };
import jsPlainTest from "./tests/js-plain" with { type: "directory" };
import pythonTest from "./tests/python" with { type: "directory" };
import pythonPlainTest from "./tests/python-plain" with { type: "directory" };
import pythonPoetryTest from "./tests/python-poetry" with { type: "directory" };
import pythonPyprojectTest from "./tests/python-pyproject" with {
	type: "directory",
};
import rubyGemTest from "./tests/ruby-gem" with { type: "directory" };
import rubyPlainTest from "./tests/ruby-plain" with { type: "directory" };
import rustCargoTest from "./tests/rust-cargo" with { type: "directory" };
import rustPlainTest from "./tests/rust-plain" with { type: "directory" };
import tsPlainTest from "./tests/ts-plain" with { type: "directory" };

export const metadata = {
	name: "autobuild",
	version: "0.0.0",
};

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	kind?: Kind;
	host?: string;
	source: tg.Directory;
};

export const default_ = tg.target(async (arg: Arg) => {
	const { source } = arg;
	const sourceId = await source.id();
	console.log("received source dir", sourceId);
	const kind = await detectKind(source);

	switch (kind) {
		case "cc-autotools": {
			return autotools.default_(arg);
		}
		case "c-plain": {
			return tg.unimplemented();
		}
		case "cxx-plain": {
			return tg.unimplemented();
		}
		case "fortran-plain": {
			return tg.unimplemented();
		}
		case "cmake": {
			return cmake.default_(arg);
		}
		case "go": {
			return go.default_(arg);
		}
		case "js-node": {
			return js.node(arg);
		}
		case "js-plain": {
			const toolchain = await nodejs.toolchain();
			const interpreter = await toolchain.get("bin/node").then(tg.File.expect);
			return wrapScripts({ directory: source, extension: ".js", interpreter });
		}
		case "python": {
			return python.default_(arg);
		}
		case "python-plain": {
			const toolchain = await python.toolchain();
			const interpreter = await toolchain
				.get("bin/python3")
				.then(tg.File.expect);
			return wrapScripts({
				directory: source,
				extension: ".py",
				interpreter,
				env: {
					PYTHONPATH: toolchain,
				},
			});
			return python.plain({ source });
		}
		case "python-poetry": {
			return python.poetry({ source });
		}
		case "python-pyproject": {
			const pyprojectToml = await source
				.get("pyproject.toml")
				.then(tg.File.expect);
			return python.pyproject({ source });
		}
		case "ruby-gem": {
			return ruby.gem({ source });
		}
		case "ruby-plain": {
			const toolchain = await ruby.toolchain();
			const interpreter = await toolchain.get("bin/ruby").then(tg.File.expect);
			return wrapScripts({ directory: source, extension: ".rb", interpreter });
		}
		case "rust-cargo": {
			return rust.cargo({ source });
		}
		case "rust-plain": {
			return rust.plain({ source });
		}
		case "ts-plain": {
			const toolchain = await bun.toolchain();
			const interpreter = await toolchain.get("bin/bun").then(tg.File.expect);
			return wrapScripts({ directory: source, extension: ".ts", interpreter });
		}
		default: {
			throw new Error(
				`unable to autodetect project type, edit your tangram.ts file to define desired behavior`,
			);
		}
	}
});

export default default_;

export type Kind =
	| "cc-autotools"
	| "c-plain"
	| "cxx-plain"
	| "fortran-plain"
	| "cmake"
	| "go"
	| "js-node"
	| "js-plain"
	| "python"
	| "python-plain"
	| "python-poetry"
	| "python-pyproject"
	| "ruby-gem"
	| "ruby-plain"
	| "rust-cargo"
	| "rust-plain"
	| "ts-plain";

export const detectKind = async (source: tg.Directory): Promise<Kind> => {
	const entries = await source.entries();
	const hasFile = (name: string) =>
		entries.hasOwnProperty(name) && entries[name] instanceof tg.File;
	const hasExecutableFile = (name: string) =>
		entries.hasOwnProperty(name) &&
		entries[name] instanceof tg.File &&
		entries[name].executable();
	const hasDir = (name: string) =>
		entries.hasOwnProperty(name) && entries[name] instanceof tg.Directory;
	const hasFileWithExtension = (ext: string) =>
		Object.entries(entries).some(
			([name, artifact]) => artifact instanceof tg.File && name.endsWith(ext),
		);

	if (hasFile("Cargo.toml")) return "rust-cargo";
	if (hasFile("CMakeLists.txt")) return "cmake";
	if (hasExecutableFile("configure") || hasFile("configure.ac"))
		return "cc-autotools";
	if (hasFile("package.json")) return "js-node";
	if (hasFile("poetry.lock")) return "python-poetry";
	if (hasFile("pyproject.toml")) return "python-pyproject";
	if (hasFile("setup.py") || hasFile("setup.cfg")) return "python";
	if (hasFile("go.mod") || hasDir("vendor")) return "go";
	if (hasFile("Gemfile")) return "ruby-gem";

	if (hasFileWithExtension(".rb")) return "ruby-plain";
	if (hasFileWithExtension(".rs")) return "rust-plain";
	if (hasFileWithExtension(".py")) return "python-plain";
	if (hasFileWithExtension(".js")) return "js-plain";
	if (hasFileWithExtension(".ts")) return "ts-plain";
	if (
		hasFileWithExtension(".f90") ||
		hasFileWithExtension(".f77") ||
		hasFileWithExtension(".f") ||
		hasFileWithExtension(".for")
	)
		return "fortran-plain";
	if (hasFileWithExtension(".cxx") || hasFileWithExtension(".cpp"))
		return "cxx-plain";
	if (hasFileWithExtension(".c")) return "c-plain";

	// We didn't match any known types.
	throw new Error("failed to detect project kind");
};

// TODO
// dir with no runnable files
// meson
// php
// dirs with multiple types of files

export const test = tg.target(async () => {
	const allKinds: Array<Kind> = [
		// "cc-autotools",
		// "c-plain",
		// "cxx-plain",
		// "fortran-plain",
		// "cmake", // ninja, error, no such target "install"
		// "go", // failed to start telemetry sidecar, no dependencies to vendor.
		// "js-node",
		// "js-plain",
		// "python",
		// "python-plain",
		// "python-poetry",
		// "python-pyproject",
		// "ruby-gem",
		// "ruby-plain",
		// "rust-cargo",
		// "rust-plain",
		// "ts-plain",
	];
	await Promise.all(allKinds.map((variant) => testKind(variant)));

	return true;
});

type TestFnArg = {
	testFile: (buildOutput: tg.Directory) => Promise<tg.Template>;
	expectedStdout: string;
};

const defaultTestArg: TestFnArg = {
	testFile: (buildOutput: tg.Directory): Promise<tg.Template> =>
		tg`${buildOutput}/bin/test`,
	expectedStdout: "Hello, world!",
};

const testParamaters = (): Record<Kind, TestFnArg> => {
	return {
		"cc-autotools": defaultTestArg,
		"c-plain": defaultTestArg,
		"cxx-plain": defaultTestArg,
		"fortran-plain": defaultTestArg,
		cmake: defaultTestArg,
		go: {
			...defaultTestArg,
			testFile: (buildOutput: tg.Directory): Promise<tg.Template> =>
				tg`${buildOutput}/bin/hello`,
		},
		"js-node": defaultTestArg,
		"js-plain": defaultTestArg,
		python: defaultTestArg,
		"python-plain": defaultTestArg,
		"python-poetry": defaultTestArg,
		"python-pyproject": defaultTestArg,
		"ruby-gem": defaultTestArg,
		"ruby-plain": defaultTestArg,
		"rust-cargo": defaultTestArg,
		"rust-plain": defaultTestArg,
		"ts-plain": defaultTestArg,
	};
};

// FIXME - this is silly, we should be able to just grab the subdir with the right name.
const testDirs = (): Record<Kind, tg.Directory> => {
	return {
		"cc-autotools": ccAutotoolsTest,
		"c-plain": cPlainTest,
		"cxx-plain": cxxPlainTest,
		"fortran-plain": fortranPlainTest,
		cmake: cmakeTest,
		go: goTest,
		"js-node": jsNodeTest,
		"js-plain": jsPlainTest,
		python: pythonTest,
		"python-plain": pythonPlainTest,
		"python-poetry": pythonPoetryTest,
		"python-pyproject": pythonPyprojectTest,
		"ruby-gem": rubyGemTest,
		"ruby-plain": rubyPlainTest,
		"rust-cargo": rustCargoTest,
		"rust-plain": rustPlainTest,
		"ts-plain": tsPlainTest,
	};
};

export const testKind = tg.target(async (kind: Kind) => {
	const source = await testDirs()[kind];

	// Test detection
	console.log("source", await source.id());
	const detectedKind = await detectKind(source);
	// FIXME - with === - why aren't they the same type? expected go, got go ??
	tg.assert(detectedKind == kind, `expected ${kind}, got ${detectedKind}`);

	// Test build
	const buildOutput = await default_({ source }).then(tg.Directory.expect);
	console.log("buildOutput", await buildOutput.id());
	const testStdout = async (arg: TestFnArg): Promise<boolean> => {
		const stdout = await $`${arg.testFile(buildOutput)} > $OUTPUT`
			.then(tg.File.expect)
			.then((t) => t.text())
			.then((t) => t.trim());
		tg.assert(stdout === arg.expectedStdout);
		return true;
	};
	await testStdout(testParamaters()[kind]);
	return true;
});

type WrapScriptsArg = std.wrap.ArgObject & {
	directory: tg.Directory;
	extension: string;
};

/** Wrap all the scripts with a given extension to use the given interpreter */
const wrapScripts = async (arg: WrapScriptsArg): Promise<tg.Directory> => {
	const { directory, extension, ...wrapArg } = arg;
	let ret = arg.directory;
	for await (const [name, artifact] of arg.directory) {
		if (name.endsWith(extension) && artifact instanceof tg.File) {
			ret = await tg.directory(ret, {
				[`${name}`]: std.wrap(artifact, wrapArg),
			});
		}
	}
	return ret;
};

/** We need to generate the distribution bundle for the `cc-autotools` test package, generating the configure scripts and intermediate makefile templates. */
// FIXME - this fails!! autreconf is not able to run.
export const prepareAutotoolsTestDistributionBundle = tg.target(async () => {
	const originalSource = ccAutotoolsTest;
	return $`set -eux && cp -R ${originalSource} $OUTPUT && chmod -R u+w $OUTPUT && cd $OUTPUT && env && which autoconf && autoreconf --install`
		.env(autoconf(), automake())
		.then(tg.Directory.expect);
});
