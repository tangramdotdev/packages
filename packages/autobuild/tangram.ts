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

import tests from "./tests" with { type: "directory" };

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
			// return js.node(arg);
			return tg.unimplemented();
		}
		case "js-plain": {
			// const toolchain = await nodejs.toolchain();
			// const interpreter = await toolchain.get("bin/node").then(tg.File.expect);
			// return wrapScripts({ directory: source, extension: ".js", interpreter });
			// return js.plain(arg);
			return tg.unimplemented();
		}
		case "python": {
			// return python.default_(arg);
			return tg.unimplemented();
		}
		case "python-plain": {
			// const toolchain = await python.toolchain();
			// const interpreter = await toolchain
			// 	.get("bin/python3")
			// 	.then(tg.File.expect);
			// return wrapScripts({
			// 	directory: source,
			// 	extension: ".py",
			// 	interpreter,
			// 	env: {
			// 		PYTHONPATH: toolchain,
			// 	},
			// });
			// return python.plain({ source });
			return tg.unimplemented();
		}
		case "python-poetry": {
			// return python.poetry({ source });
			return tg.unimplemented();
		}
		case "python-pyproject": {
			// const pyprojectToml = await source
			// 	.get("pyproject.toml")
			// 	.then(tg.File.expect);
			// return python.pyproject({ source });
			return tg.unimplemented();
		}
		case "ruby-gem": {
			// return ruby.gem({ source });
			return tg.unimplemented();
		}
		case "ruby-plain": {
			// const toolchain = await ruby.toolchain();
			// const interpreter = await toolchain.get("bin/ruby").then(tg.File.expect);
			// return wrapScripts({ directory: source, extension: ".rb", interpreter });
			// return ruby.plain({ source });
			return tg.unimplemented();
		}
		case "rust-cargo": {
			// return rust.cargo({ source });
			return tg.unimplemented();
		}
		case "rust-plain": {
			// return rust.plain({ source });
			return tg.unimplemented();
		}
		case "ts-plain": {
			// const toolchain = await bun.toolchain();
			// const interpreter = await toolchain.get("bin/bun").then(tg.File.expect);
			// return wrapScripts({ directory: source, extension: ".ts", interpreter });
			// return ts.default_({ source });
			return tg.unimplemented();
		}
		case "unknown":
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
	| "ts-plain"
	| "unknown";

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
	if (hasExecutableFile("configure") || hasFile("configure.ac")) return "cc-autotools";
	if (hasFile("package.json")) return "js-node";
	if (hasFile("pyproject.toml")) return "python-pyproject";
	if (hasFile("poetry.lock")) return "python-poetry";
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
	return "unknown";
};

// TODO
// dir with no runnable files
// meson
// php
// dirs with multiple types of files

export const test = tg.target(async () => {
	const allVariants: Array<Kind> = [
		"cc-autotools",
		"c-plain",
		"cxx-plain",
		"fortran-plain",
		"cmake",
		"go",
		"js-node",
		"js-plain",
		"python",
		"python-plain",
		"python-poetry",
		"python-pyproject",
		"ruby-gem",
		"ruby-plain",
		"rust-cargo",
		"rust-plain",
		"ts-plain",
	];
	await Promise.all(allVariants.map((variant) => testKind(variant)));

	return true;
});

export const testKind = tg.target(async (kind: Kind) => {
	await testDetectKind(kind);
	// await testBuildKind(kind);
	return true;
});

export const testDetectKind = tg.target(async (kind: Kind) => {
	const source = await tests.get(kind).then(tg.Directory.expect);
	const detectedKind = await detectKind(source);
	tg.assert(detectedKind === kind, `expected ${kind}, got ${detectedKind}`);
	return true;
});

// export const testBuildKind = tg.target(async (kind: Kind, outputTestFn?: (output: tg.Directory) => Promise<boolean>) => {
// 	const source = await tests.get(kind).then(tg.Directory.expect);
// 	const buildOutput = await default_({ source }).then(tg.Directory.expect);
// 	const outputTestFn_ = outputTestFn ?? async (output: tg.Directory) => {
// 		const expected = "Hello, world!";
// 		const actual = await $`${output}/bin/test > $OUTPUT`.then(tg.File.expect).then((t) => t.text()).then((t) => t.trim());
// 		tg.assert(expected === actual);
// 		return true;
// 	};
// 	await outputTestFn_(buildOutput);
// 	return true;
// });

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
	const originalSource = await tests
		.get("cc-autotools")
		.then(tg.Directory.expect);
	return $`set -eux && cp -R ${originalSource} $OUTPUT && chmod -R u+w $OUTPUT && cd $OUTPUT && env && which autoconf && autoreconf --install`
		.env(autoconf(), automake())
		.then(tg.Directory.expect);
});
