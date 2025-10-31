import * as std from "./tangram.ts";
import { $ } from "./run.tg.ts";
import {
	fileOrSymlinkFromManifestTemplate,
	manifestDependencies,
	wrap,
} from "./wrap.tg.ts";
import { buildTools } from "./sdk/dependencies.tg.ts";

/** Define the expected behavior of each package component. A `PackageProvides` object is a valid `PackageSpec`, but most packages will have additional behavior to assert. */
export type PackageSpec = {
	/** All executables that should exist under `bin/`, with optional behavior to check. */
	binaries?: Array<BinarySpec>;
	/** Use bootstrap mode. This prevents including the standard environments to build and test components, all required dependencies must be explicitly provided via the `env` argument. */
	bootstrapMode?: boolean;
	/** Any documentation files that should exist under `share/`. */
	docs?: Array<string>;
	/** Additional env to include when running tests. */
	env?: std.env.Arg;
	/** The names of all header files that should exist under `include/`. */
	headers?: Array<string>;
	/** All libraries that should exist under `lib/`. By default, checks for both staticlibs and dylibs */
	libraries?: Array<LibrarySpec>;
};

/** Define the expected contents of a built package. */
export type Provides = {
	/** All executables that should exist under `bin/`. */
	binaries?: Array<string>;
	/** The names of all header files that should exist under `include/`. */
	headers?: Array<string>;
	/** All libraries that should exist under `lib/`. By default, checks for both staticlibs and dylibs */
	libraries?: Array<LibrarySpec>;
};

/** Optionally specify some behavior for a particular binary. */
export type BinarySpec =
	| string
	| {
			/** Should we require the command to exit with a 0 exit code? Default: true. */
			exitOnErr?: boolean;
			/** The name of the binary. */
			name: string;
			/** Arguments to pass. Defaults to `["--version"]`. */
			testArgs?: Array<string>;
			/** The expected output snapshot. If unspecified, defaults to checking for the package version. Whitespace is normalized before comparison. */
			snapshot?: string;
	  };

/** Optionally specify whether a particular library provides staticlibs, dylibs, or both. */
export type LibrarySpec =
	| string
	| {
			/** The base library name. For libz, this is `z`. */
			name: string;
			/** The package config name. This indicates we should expect a `lib/pkgconfig/${name}.pc` file. If not provided, assumes the same as `name`. Use `false` to indicate it should not be expected. */
			pkgConfigName?: boolean | string;
			/** Is there a dynamically linked library? E.g. `libz.so` or `libz.dylib`. */
			dylib?: boolean;
			/** Is there a static library? E.g. `libz.a`. */
			staticlib?: boolean;
			/** What additional dependencies are required at runtime to use this library? */
			runtimeDeps?: Array<tg.Unresolved<tg.Directory>>;
			/** What symbols should we expect this library to provide? */
			symbols?: Array<string>;
	  };

export type Metadata = {
	/** The package name. */
	name: string;
	/** The package version. */
	version: string;
	/** The license name or URL. */
	license?: string;
	/** The project homepage. */
	homepage?: string;
	/** The expected contents of a build package. */
	provides?: Provides;
	/** The project repository. */
	repository?: string;
	/** The tag to use for publishing. */
	tag?: string;
	/** The support build platforms (arch-os pairs) for producing this package. If not provided, assumes all supported Tangram platorms. */
	buildPlatforms?: Array<string>;
	/** The supported host platforms (arch-os pairs) for the output of this package. If not provided, assumes all supported Tangram platforms. */
	hostPlatforms?: Array<string>;
};

/** Assert a package contains the specified contents in the conventional locations.  As a packager, it's your responsibility to post-process your package's results to conform to this convention for use in the Tangram ecosystem. */
export const pkg = async <T extends std.args.PackageArg>(
	/** The function that builds the package directory. */
	buildCmd: std.packages.BuildCommand<T>,
	/** The spec for the package produced when run with no arguments. */
	defaultSpec: PackageSpec,
	/** Additional arguments with their corresponding package specs to test, if any. */
	...buildVariants: Array<[T, PackageSpec]>
) => {
	const currentHost = await std.triple.host();

	// Determine the set of arguments to test. Always test the command with no args against the default spec.
	const packageArgs: Array<[T, PackageSpec]> = [[{} as T, defaultSpec]];
	// If the user specified additional pairs, add them.
	if (buildVariants !== undefined && buildVariants.length > 0) {
		packageArgs.push(...buildVariants);
	}

	const results = await Promise.all(
		packageArgs.map(async ([packageArg, spec]) => {
			const host = packageArg.host ?? currentHost;
			let directory = await std.packages.buildCommandOutput(
				buildCmd,
				packageArg,
			);
			return await singlePackageArg(directory, host, spec);
		}),
	);

	return results.every((result) => result);
};

/** Utility to produce the default spec from a `PackageProvides`. In addition to existence checks, it will also test that all binaries report the expected version when executed with the `--version` flag. */
export const defaultSpec = (metadata: Metadata): PackageSpec => {
	const { provides } = metadata;
	return {
		...provides,
		...(provides?.binaries && {
			binaries: provides.binaries.map((name) =>
				displaysVersion(name, metadata.version),
			),
		}),
	};
};

const singlePackageArg = async (
	directory: tg.Directory,
	host: string,
	spec: PackageSpec,
) => {
	const env = spec.env ?? {};
	// Collect tests to run in parallel. To start, always assert the package directory is non-empty.
	const tests = [nonEmpty(directory)];

	// Assert the package contains the specified binaries.
	if (spec.binaries) {
		for (const binarySpec of spec.binaries) {
			const binary =
				typeof binarySpec === "string" ? { name: binarySpec } : binarySpec;
			tests.push(runnableBin({ directory, binary, env, host }));
		}
	}

	// Assert the package contains the specified documentation.
	if (spec.docs) {
		for (const docPath of spec.docs) {
			tests.push(fileExists({ directory, subpath: `share/${docPath}` }));
		}
	}

	// Assert the package contains the specified headers.
	if (spec.headers) {
		for (const header of spec.headers) {
			tests.push(headerCanBeIncluded({ directory, env, header }));
		}
	}

	// Assert the package contains the specified libraries.
	if (spec.libraries) {
		spec.libraries.forEach((lib) => {
			tests.push(linkableLib({ directory, env, host, library: lib }));
		});
	}

	await Promise.all(tests);
	return true;
};

/** Assert the provided directory has contents. */
export const nonEmpty = async (dir: tg.Directory) => {
	const entries = await dir.entries();
	tg.assert(Object.keys(entries).length > 0, "Directory is empty.");
	return true;
};

type FileExistsArg = {
	directory: tg.Directory;
	subpath: string;
};

/** Assert the provided path exists and refers to a file. */
export const fileExists = async (arg: FileExistsArg) => {
	const maybeFile = await arg.directory.tryGet(arg.subpath);
	tg.assert(maybeFile, `Path ${arg.subpath} does not exist.`);
	tg.File.assert(maybeFile);
	return true;
};

type FileExistsOneOfArg = {
	directory: tg.Directory;
	subpaths: Array<string>;
};

/** Assert at least one of the provided paths exists in the directory. Useful for heuristic checks with multiple possible locations. */
export const fileExistsOneOf = async (arg: FileExistsOneOfArg) => {
	for (const subpath of arg.subpaths) {
		const maybeFile = await arg.directory.tryGet(subpath);
		if (maybeFile !== undefined && maybeFile instanceof tg.File) {
			return true;
		}
	}
	tg.assert(
		false,
		`None of the following paths exist: ${arg.subpaths.join(", ")}`,
	);
};

type RunnableBinArg = {
	directory: tg.Directory;
	binary: BinarySpec;
	env?: std.env.Arg | undefined;
	host: string;
};

/** Assert the directory contains a binary conforming to the provided spec. */
export const runnableBin = async (arg: RunnableBinArg) => {
	if (std.triple.archAndOs(await std.triple.host()) !== arg.host) {
		return true;
	}
	let name: string | undefined;
	let snapshot: string | undefined;
	let testArgs = ["--version"];
	let exitOnErr = true;
	if (typeof arg.binary === "string") {
		name = arg.binary;
	} else {
		if (arg.binary.name) {
			name = arg.binary.name;
		}
		if (arg.binary.testArgs) {
			testArgs = arg.binary.testArgs;
		}
		if (arg.binary.snapshot) {
			snapshot = arg.binary.snapshot;
		}
		if ("exitOnErr" in arg.binary) {
			exitOnErr = arg.binary.exitOnErr;
		}
	}
	// Assert the binary exists.
	await fileExists({
		directory: arg.directory,
		subpath: `bin/${name}`,
	});

	// Run the binary with the provided test invocation.
	const executable = tg`${arg.directory}/bin/${name} ${tg.Template.join(
		" ",
		...testArgs,
	)} > $OUTPUT 2>&1`;

	const stdout = await $`${executable}`
		.bootstrap(true)
		.env(arg.env)
		.exitOnErr(exitOnErr)
		.host(arg.host)
		.then(tg.File.expect)
		.then((file) => file.text());
	if (snapshot !== undefined) {
		const normalizedSnapshot = normalizeSnapshot(snapshot);
		const normalizedStdout = normalizeSnapshot(stdout);
		tg.assert(
			normalizedStdout.includes(normalizedSnapshot),
			`Binary ${name} did not produce expected output.\n\nExpected snapshot:\n${normalizedSnapshot}\n\nActual output:\n${normalizedStdout}`,
		);
	}
	return true;
};

export const assertFileReferences = async (
	file: tg.File,
	interpreterKind: "normal" | "ld-musl" | "ld-linux",
) => {
	// Ensure the interpreter is found in the manifest dependencies.
	const fileManifest = await wrap.Manifest.read(file);
	tg.assert(fileManifest);
	tg.assert(fileManifest.interpreter?.kind === interpreterKind);
	const interpreter = fileManifest.interpreter;
	const interpreterPath = interpreter.path;
	const interpreterArtifact =
		await fileOrSymlinkFromManifestTemplate(interpreterPath);
	const interpreterId = interpreterArtifact.id;
	tg.assert(interpreterId);
	let foundManifest = false;
	for await (const dependency of manifestDependencies(fileManifest)) {
		const dependencyId = dependency.id;
		if (dependencyId === interpreterId) {
			foundManifest = true;
		}
	}
	tg.assert(
		foundManifest,
		"Could not find interpreter in manifest dependencies.",
	);

	// Ensure the interpreter is found in the file dependencies.
	const fileDependencies = await file.dependencyObjects();
	tg.assert(
		fileDependencies !== undefined && fileDependencies.length > 0,
		"No file dependencies found.",
	);
	let foundFile = false;
	for (const dependency of fileDependencies) {
		const referenceId = dependency.id;
		if (referenceId === interpreterId) {
			foundFile = true;
		}
	}
	tg.assert(foundFile, "Could not find interpreter in file dependencies.");
};

type HeaderArg = {
	directory: tg.Directory;
	env?: std.env.Arg;
	header: string;
};

/** Assert the directory contains a header file with the provided name. */
export const headerCanBeIncluded = async (arg: HeaderArg) => {
	// Ensure the file exists.
	await fileExists({
		directory: arg.directory,
		subpath: `include/${arg.header}`,
	});

	// Generate a program that expects to include this header.
	const source = tg.file`
		#include <${arg.header}>
		int main() {
			return 0;
		}`;

	// Compile the program, ensuring the env properly made the header discoverable.
	const program = await $`cc -xc "${source}" -o $OUTPUT`
		.bootstrap(true)
		.env(std.sdk(), arg.directory)
		.then(tg.File.expect);

	// Run the program.
	await $`${program}`;
	return true;
};

type LibraryArg = {
	directory: tg.Directory;
	env?: std.env.Arg;
	host: string;
	library: LibrarySpec;
	sdk?: std.sdk.Arg;
};

/** Assert the directory contains a library conforming to the provided spec. */
export const linkableLib = async (arg: LibraryArg) => {
	// Set up parameters.
	let name: string | undefined;
	let pkgConfigName: string | undefined;
	let pkgConfigNameExplicit = false;
	let host = arg.host;
	let dylib = true;
	let staticlib = true;
	const env = arg.env ?? {};
	const sdk = arg.sdk;
	let runtimeDeps: Array<tg.Unresolved<tg.Directory>> = [];
	if (typeof arg.library === "string") {
		name = arg.library;
		pkgConfigName = arg.library;
		pkgConfigNameExplicit = false;
	} else {
		name = arg.library.name;
		// Handle pkgConfigName: defaults to name, unless explicitly set to false or a custom string.
		if (arg.library.pkgConfigName === false) {
			pkgConfigName = undefined;
			pkgConfigNameExplicit = true;
		} else if (typeof arg.library.pkgConfigName === "string") {
			pkgConfigName = arg.library.pkgConfigName;
			pkgConfigNameExplicit = true;
		} else {
			pkgConfigName = arg.library.name;
			pkgConfigNameExplicit = false;
		}
		if (arg.library.dylib !== undefined) {
			dylib = arg.library.dylib;
		}
		if (arg.library.staticlib !== undefined) {
			staticlib = arg.library.staticlib;
		}
		if (arg.library.runtimeDeps !== undefined) {
			runtimeDeps = arg.library.runtimeDeps;
		}
	}

	// Collect tests.
	const tests = [];

	const hostOs = std.triple.os(await std.triple.host());
	const dylibExtension = hostOs === "darwin" ? "dylib" : "so";

	const dylibName = (name: string) => `lib${name}.${dylibExtension}`;

	// Resolve the actual pkg-config name by checking which file exists.
	let resolvedPkgConfigName = pkgConfigName;
	if (pkgConfigName !== undefined) {
		// If pkgConfigName was explicitly provided, check only that exact name.
		// Otherwise, use a heuristic to try both {name}.pc and lib{name}.pc.
		if (pkgConfigNameExplicit) {
			tests.push(
				fileExists({
					directory: arg.directory,
					subpath: `lib/pkgconfig/${pkgConfigName}.pc`,
				}),
			);
		} else {
			// Determine which file actually exists
			const nameExists = await fileExists({
				directory: arg.directory,
				subpath: `lib/pkgconfig/${pkgConfigName}.pc`,
			}).catch(() => false);

			if (nameExists) {
				resolvedPkgConfigName = pkgConfigName;
			} else {
				const libNameExists = await fileExists({
					directory: arg.directory,
					subpath: `lib/pkgconfig/lib${pkgConfigName}.pc`,
				}).catch(() => false);

				if (libNameExists) {
					resolvedPkgConfigName = `lib${pkgConfigName}`;
				} else {
					throw new Error(`pkg-config file not found for ${pkgConfigName}`);
				}
			}
		}
	}

	// Check for the dylib if requested.
	if (dylib) {
		const dylibName_ = dylibName(name);
		tests.push(
			fileExists({
				directory: arg.directory,
				subpath: `lib/${dylibName_}`,
			}).then(() =>
				testDylib({
					directory: arg.directory,
					libraryName: name,
					pkgConfigName: resolvedPkgConfigName,
					env,
					host,
					runtimeDepDirs: runtimeDeps,
					sdk,
				}),
			),
		);
	}

	// Check for the staticlib if requested.
	if (staticlib) {
		tests.push(
			fileExists({
				directory: arg.directory,
				subpath: `lib/lib${name}.a`,
			}).then(() =>
				testStaticlib({
					directory: arg.directory,
					library: name,
					pkgConfigName: resolvedPkgConfigName,
					env,
					host,
					runtimeDepDirs: runtimeDeps,
					sdk,
				}),
			),
		);
	}

	await Promise.all(tests);
	return true;
};

/** Helper to get pkg-config flags for a library. Returns undefined if pkg-config fails. */
const getPkgConfigFlags = async (
	pkgConfigName: string,
	env: tg.Unresolved<std.env.Arg>,
): Promise<string | undefined> => {
	try {
		const flags = await $`pkg-config --cflags --libs ${pkgConfigName} > $OUTPUT`
			.env(env)
			.then(tg.File.expect)
			.then((f) => f.text())
			.then((text) => text.trim());
		return flags;
	} catch {
		return undefined;
	}
};

type TestDylibArg = {
	directory: tg.Directory;
	libraryName: string;
	pkgConfigName?: string | undefined;
	env?: std.env.Arg;
	host: string;
	runtimeDepDirs: Array<tg.Unresolved<tg.Directory>>;
	sdk?: std.sdk.Arg;
	testSource?: string;
};

/** Compile, link, and run a program against a dynamic library. */
export const testDylib = async (arg: TestDylibArg) => {
	if (arg.host != (await std.triple.host())) {
		throw new Error("unsupported");
	}

	const directory = arg.directory;
	const libraryName = arg.libraryName;
	const hostOs = std.triple.os(arg.host);
	const dylibExtension = hostOs === "darwin" ? "dylib" : "so";
	const dylibName = `lib${libraryName}.${dylibExtension}`;

	let source: tg.Unresolved<tg.File>;
	if (arg.testSource) {
		// Use provided test code
		source = tg.file(arg.testSource);
	} else {
		// Extract a symbol to reference, proving the library exports something
		const nmFlags = hostOs === "darwin" ? "-gU" : "-D";
		const dylibPath = tg`${directory}/lib/${dylibName}`;

		const symbols =
			await $`nm ${nmFlags} "${dylibPath}" | grep ' T ' | head -1 > $OUTPUT`
				.env(std.sdk(arg?.sdk))
				.then(tg.File.expect)
				.then((f) => f.text())
				.catch(() => null);

		if (symbols && symbols.trim()) {
			const symbol = symbols.trim().split(/\s+/).pop() ?? "";
			if (symbol) {
				// On Linux, nm may return versioned symbols like "symbol@@VERSION"
				// Strip version info (everything from first @ onwards)
				let cleanSymbol = symbol.includes("@")
					? symbol.substring(0, symbol.indexOf("@"))
					: symbol;

				// On macOS, nm returns symbols with leading underscore (_adler32)
				// but C extern declarations add their own underscore, so strip it
				if (hostOs === "darwin" && cleanSymbol.startsWith("_")) {
					cleanSymbol = cleanSymbol.substring(1);
				}

				// Reference the symbol (but don't call it - may need args we don't know).
				source = tg.file`
					extern void ${cleanSymbol}();
					int main() {
						// Reference but don't call - just ensure it links
						void* ptr = (void*)&${cleanSymbol};
						return ptr ? 0 : 1;
					}`;
			} else {
				// Fallback: just link, don't reference anything specific.
				source = tg.file`int main() { return 0; }`;
			}
		} else {
			// Fallback: just link, don't reference anything specific.
			source = tg.file`int main() { return 0; }`;
		}
	}

	// Set up environment with pkg-config and all directories
	const sdkEnv = std.sdk(arg?.sdk);
	const pkgConfigEnv = buildTools({ level: "pkgconfig" });
	const allEnvDirs = [directory, ...arg.runtimeDepDirs];
	const compileEnv = std.env.arg(sdkEnv, pkgConfigEnv, ...allEnvDirs, arg.env, {
		utils: false,
	});

	// Get pkg-config flags if available
	let compileFlags = `-l${libraryName}`;
	if (arg.pkgConfigName) {
		const pkgConfigFlags = await getPkgConfigFlags(
			arg.pkgConfigName,
			compileEnv,
		);
		if (pkgConfigFlags) {
			compileFlags = pkgConfigFlags;
		}
	}

	// Compile and link using the flags from pkg-config or fallback
	const program = await $`cc -xc "${source}" ${compileFlags} -o $OUTPUT`
		.bootstrap(true)
		.env(compileEnv)
		.host(arg.host)
		.then(tg.File.expect);

	// Run the program to ensure it's functional
	await $`${program}`.bootstrap(true).env(arg.env).host(arg.host);

	return true;
};

type TestStaticlibArg = {
	directory: tg.Directory;
	library: string;
	pkgConfigName?: string | undefined;
	env?: std.env.Arg;
	host: string;
	runtimeDepDirs?: Array<tg.Unresolved<tg.Directory>>;
	sdk?: std.sdk.Arg;
	testSource?: string;
};

/** Compile, link, and run a program against a static library. */
export const testStaticlib = async (arg: TestStaticlibArg) => {
	if (arg.host != (await std.triple.host())) {
		throw new Error("unsupported");
	}

	let source: tg.Unresolved<tg.File>;
	if (arg.testSource) {
		// Use provided test code
		source = tg.file(arg.testSource);
	} else {
		// Generate a minimal program - static linking will fail if library is broken
		source = tg.file`int main() { return 0; }`;
	}

	// Set up environment with pkg-config and all directories
	const sdkEnv = std.sdk(arg?.sdk);
	const pkgConfigEnv = buildTools({ level: "pkgconfig" });
	const runtimeDepDirs = arg.runtimeDepDirs ?? [];
	const allEnvDirs = [arg.directory, ...runtimeDepDirs];
	const compileEnv = std.env.arg(sdkEnv, pkgConfigEnv, ...allEnvDirs, arg.env, {
		utils: false,
	});

	// Get pkg-config flags if available
	let compileFlags = `-l${arg.library}`;
	if (arg.pkgConfigName) {
		const pkgConfigFlags = await getPkgConfigFlags(
			arg.pkgConfigName,
			compileEnv,
		);
		if (pkgConfigFlags) {
			compileFlags = pkgConfigFlags;
		}
	}

	// Compile and link statically against the library
	const program = await $`cc -xc "${source}" ${compileFlags} -o $OUTPUT`
		.bootstrap(true)
		.env(compileEnv)
		.host(arg.host)
		.then(tg.File.expect);

	// Run the program to ensure it's functional
	await $`${program}`.bootstrap(true).env(arg.env).host(arg.host);

	return true;
};

/** Given a library filename, get the basename to pass to a compiler. Throws if no match. */
export const baseName = (lib: string): string => {
	const maybeBaseName = tryBaseName(lib);
	tg.assert(
		maybeBaseName,
		`Library name ${lib} does not match expected pattern.`,
	);
	return maybeBaseName;
};

/** Given a library filename, get the basename to pass to a compiler. Returns undefined if no match. */
export const tryBaseName = (lib: string): string | undefined => {
	const match = lib.match(/^lib(.*)\.(a|so|dylib)$/);
	if (!match) {
		return undefined;
	}
	return match[1];
};

/** Ensure the given host is supported according to the metadata. */
export const supportedHost = (currentHost: string, metadata?: Metadata) => {
	const supportedHosts = metadata?.hostPlatforms ?? std.triple.allHosts;
	tg.assert(
		supportedHosts.includes(currentHost),
		`current host ${currentHost} not found in supported hosts: ${supportedHosts}.`,
	);
};

/** Execute the given file and assert the resulting `stdout` includes the provided string. */
export const stdoutIncludes = async (
	file: tg.Unresolved<tg.File>,
	expected: string,
) => {
	const stdout = await $`${file} > $OUTPUT`
		.bootstrap(true)
		.env({
			TANGRAM_WRAPPER_TRACING: "tangram_wrapper=trace",
		})
		.then(tg.File.expect)
		.then((f) => f.text());
	tg.assert(stdout.includes(expected));
};

/** Spec helper to assert the given package displays the given version. */
export const displaysVersion = (name: string, version: string) => {
	return {
		name,
		testArgs: ["--version"],
		snapshot: version,
	};
};

/** Helper to create a binary spec without redundantly specifying the name field. */
export function binary(name: string): string;
export function binary(
	name: string,
	overrides: {
		testArgs?: Array<string>;
		snapshot?: string;
		exitOnErr?: boolean;
	},
): {
	name: string;
	testArgs?: Array<string>;
	snapshot?: string;
	exitOnErr?: boolean;
};
export function binary(
	name: string,
	overrides?: {
		testArgs?: Array<string>;
		snapshot?: string;
		exitOnErr?: boolean;
	},
): BinarySpec {
	if (!overrides || Object.keys(overrides).length === 0) {
		return name;
	}
	return {
		name,
		...overrides,
	};
}

/** Helper to create binary specs from a list of names with selective overrides. */
export const binaries = (
	names: Array<string>,
	overrides?: Record<
		string,
		{
			testArgs?: Array<string>;
			snapshot?: string;
			exitOnErr?: boolean;
		}
	>,
): Array<BinarySpec> => {
	return names.map((name) => {
		const override = overrides?.[name];
		return override ? { name, ...override } : name;
	});
};

/** Helper to create binary specs from a list of names, applying the same override to all. */
export const allBinaries = (
	names: Array<string>,
	override: {
		testArgs?: Array<string>;
		snapshot?: string;
		exitOnErr?: boolean;
	},
): Array<BinarySpec> => {
	return names.map((name) => ({ name, ...override }));
};

/** Helper to create a library spec without redundantly specifying the name field. */
export function library(name: string): string;
export function library(
	name: string,
	overrides: {
		pkgConfigName?: boolean | string;
		dylib?: boolean;
		staticlib?: boolean;
		runtimeDeps?: Array<tg.Unresolved<tg.Directory>>;
		symbols?: Array<string>;
	},
): {
	name: string;
	pkgConfigName?: boolean | string;
	dylib?: boolean;
	staticlib?: boolean;
	runtimeDeps?: Array<tg.Unresolved<tg.Directory>>;
	symbols?: Array<string>;
};
export function library(
	name: string,
	overrides?: {
		pkgConfigName?: boolean | string;
		dylib?: boolean;
		staticlib?: boolean;
		runtimeDeps?: Array<tg.Unresolved<tg.Directory>>;
		symbols?: Array<string>;
	},
): LibrarySpec {
	if (!overrides || Object.keys(overrides).length === 0) {
		return name;
	}
	return {
		name,
		...overrides,
	};
}

/** Helper to create library specs from a list of names with selective overrides. */
export const libraries = (
	names: Array<string>,
	overrides?: Record<
		string,
		{
			pkgConfigName?: boolean | string;
			dylib?: boolean;
			staticlib?: boolean;
			runtimeDeps?: Array<tg.Unresolved<tg.Directory>>;
			symbols?: Array<string>;
		}
	>,
): Array<LibrarySpec> => {
	return names.map((name) => {
		const override = overrides?.[name];
		return override ? { name, ...override } : name;
	});
};

/** Helper to create library specs from a list of names, applying the same configuration to all. */
export const allLibraries = (
	names: Array<string>,
	config: {
		pkgConfigName?: boolean | string;
		dylib?: boolean;
		staticlib?: boolean;
		runtimeDeps?: Array<tg.Unresolved<tg.Directory>>;
		symbols?: Array<string>;
	},
): Array<LibrarySpec> => {
	return names.map((name) => ({ name, ...config }));
};

/** Normalize a string by removing common leading whitespace from all lines. */
const normalizeString = (input: string): string => {
	// Split the lines.
	let lines = input.split("\n");

	// Trim leading empty lines.
	while (lines.length > 0 && lines[0]?.trim() === "") {
		lines = lines.slice(1);
	}
	// Trim trailing empty lines.
	while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
		lines = lines.slice(0, -1);
	}

	if (lines.length === 0) {
		return "";
	}

	// Get the number of leading whitespace characters to remove.
	let leadingWhitespaceCount = Math.min(
		...lines
			.filter((line) => line.trim().length > 0)
			.map((line) => line.search(/\S|$/)),
	);

	// Remove the leading whitespace from each line, normalize tabs to spaces, and combine with newlines.
	return lines
		.map((line) => line.slice(leadingWhitespaceCount).replace(/\t/g, "  "))
		.join("\n");
};

export const dedent = (
	strings: TemplateStringsArray,
	...placeholders: Array<string>
): string => {
	// Concatenate the strings and placeholders.
	let string = "";
	let i = 0;

	while (i < placeholders.length) {
		string += strings[i];
		string += placeholders[i];
		i = i + 1;
	}
	string += strings[i];

	return normalizeString(string);
};

/** Normalize a snapshot string for comparison by removing common leading whitespace. */
export const normalizeSnapshot = (snapshot: string): string => {
	return normalizeString(snapshot);
};

/** Sort object keys recursively for consistent comparison */
const sortKeys = (obj: unknown): unknown => {
	if (obj === null || typeof obj !== "object") {
		return obj;
	}
	if (Array.isArray(obj)) {
		return obj.map(sortKeys);
	}
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(obj).sort()) {
		sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
	}
	return sorted;
};

/** Assert that a value matches a JSON snapshot. Compares structure by parsing and normalizing both sides. */
export const assertJsonSnapshot = (
	actual: unknown,
	expected: string,
	message?: string,
) => {
	// Parse the expected snapshot as JSON to compare structure, not formatting
	const expectedParsed = JSON.parse(normalizeSnapshot(expected));

	// Sort keys in both for order-independent comparison
	const actualSorted = sortKeys(actual);
	const expectedSorted = sortKeys(expectedParsed);

	// Stringify both with consistent formatting
	const actualJson = JSON.stringify(actualSorted, null, 2);
	const expectedJson = JSON.stringify(expectedSorted, null, 2);

	tg.assert(
		actualJson === expectedJson,
		message ??
			`JSON snapshot mismatch.\n\nExpected:\n${expectedJson}\n\nActual:\n${actualJson}`,
	);
};

const allPlatforms = [
	"aarch64-linux",
	"aarch64-macos",
	"x86_64-macos",
	"x86_64-linux",
];

const allBuildHostPairs = (metadata: Metadata): Array<std.args.PackageArg> => {
	const buildPlatforms = metadata.buildPlatforms ?? allPlatforms;
	const hostPlatforms = metadata.hostPlatforms ?? allPlatforms;
	const results: Array<std.args.PackageArg> = [];
	for (const build of buildPlatforms) {
		for (const host of hostPlatforms) {
			results.push({ build, host });
		}
	}
	return results;
};

// Some options for tuning the generation - this can generate huge matrices quickly.
type GenerateArgsOptions = {
	// Should we be able to cross-compile to a different arch, same OS?
	crossArch?: boolean;
	// Should we be able to cross-compile to a different OS, same arch?
	crossOs?: boolean;
	// Should we be able to cross both arch and os?
	crossArchAndOs?: boolean;
	// Should we try toggling all booleans on and off?
	toggleBools?: boolean;
};

/** Generate all permutations of package arg. */
const generatePackageArgs = <T extends std.args.PackageArg>(
	metadata: std.assert.Metadata,
	options?: GenerateArgsOptions,
): Array<T> => {
	return tg.unimplemented();
};
