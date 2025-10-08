import * as std from "./tangram.ts";
import { $ } from "./run.tg.ts";
import {
	fileOrSymlinkFromManifestTemplate,
	manifestDependencies,
	wrap,
} from "./wrap.tg.ts";

// ========== New Composable Test System ==========

/** Configurable path conventions for package layouts. */
export type PathConfig = {
	binDir: string;
	libDir: string;
	includeDir: string;
	shareDir: string;
	pkgConfigDir: string;
};

/** Default path configuration following standard Unix conventions. */
export const defaultPaths: PathConfig = {
	binDir: "bin",
	libDir: "lib",
	includeDir: "include",
	shareDir: "share",
	pkgConfigDir: "lib/pkgconfig",
};

/** Context provided to test execution functions. */
export type TestContext = {
	/** The package directory being tested. */
	directory: tg.Directory;
	/** Additional environment variables for test execution. */
	env?: std.env.Arg;
	/** The host triple for the test. */
	host: string;
	/** Path configuration for locating package components. */
	paths: PathConfig;
	/** Bootstrap mode flag. */
	bootstrapMode?: boolean;
};

/** A single test that can be executed. */
export type Test = {
	/** Human-readable test name. */
	name: string;
	/** The test execution function. */
	run: (context: TestContext) => Promise<boolean>;
};

/** Result of running a single test. */
export type TestResult = {
	/** The test that was run. */
	test: Test;
	/** Whether the test passed. */
	passed: boolean;
	/** Error message if the test failed. */
	error?: string;
	/** Duration in milliseconds. */
	duration?: number;
};

/** Collection of tests to run together. */
export type TestSuite = {
	/** Tests to execute. */
	tests: Array<Test>;
	/** Run tests in parallel (default: true). */
	parallel?: boolean;
	/** Filter function to select which tests to run. */
	filter?: (test: Test) => boolean;
	/** Progress callback invoked after each test completes. */
	onProgress?: (result: TestResult) => void;
};

/** Results from running a test suite. */
export type TestResults = {
	/** Individual test results. */
	results: Array<TestResult>;
	/** Total number of tests run. */
	total: number;
	/** Number of passed tests. */
	passed: number;
	/** Number of failed tests. */
	failed: number;
	/** Total duration in milliseconds. */
	duration: number;
};

/** Execute a test suite and return results. */
export const runTests = async (suite: TestSuite): Promise<TestResults> => {
	const startTime = Date.now();

	// Apply filter if provided.
	let tests = suite.tests;
	if (suite.filter) {
		tests = tests.filter(suite.filter);
	}

	// Run tests in parallel or sequentially.
	const parallel = suite.parallel ?? true;
	const results: Array<TestResult> = [];

	if (parallel) {
		const promises = tests.map((test) => runSingleTest(test));
		const testResults = await Promise.all(promises);
		results.push(...testResults);
	} else {
		for (const test of tests) {
			const result = await runSingleTest(test);
			results.push(result);
		}
	}

	// Invoke progress callback for each result if provided.
	if (suite.onProgress) {
		for (const result of results) {
			suite.onProgress(result);
		}
	}

	const endTime = Date.now();
	const passed = results.filter((r) => r.passed).length;
	const failed = results.filter((r) => !r.passed).length;

	return {
		results,
		total: results.length,
		passed,
		failed,
		duration: endTime - startTime,
	};
};

/** Execute a single test and capture the result. */
const runSingleTest = async (
	test: Test,
	context?: TestContext,
): Promise<TestResult> => {
	const startTime = Date.now();
	try {
		// Tests created by the builder will have context already bound in their run function.
		// If context is provided here, it will be passed to the test.
		let passed: boolean;
		if (context) {
			passed = await test.run(context);
		} else {
			// If no context provided, the test's run function should be a closure that captures its own context.
			// Cast to any to handle both signatures.
			passed = await (test.run as () => Promise<boolean>)();
		}
		const endTime = Date.now();
		return {
			test,
			passed,
			duration: endTime - startTime,
		};
	} catch (error) {
		const endTime = Date.now();
		return {
			test,
			passed: false,
			error: error instanceof Error ? error.message : String(error),
			duration: endTime - startTime,
		};
	}
};

// ========== Composable Test Builder ==========

export type TestBuilder = {
	/** Configure environment variables. */
	withEnv: (env: std.env.Arg) => TestBuilder;
	/** Configure the host triple. */
	withHost: (host: string) => TestBuilder;
	/** Configure path conventions. */
	withPaths: (paths: Partial<PathConfig>) => TestBuilder;
	/** Enable bootstrap mode. */
	withBootstrap: (enabled: boolean) => TestBuilder;

	/** Add a binary test. */
	binary: (name: string) => BinaryTestBuilder;
	/** Add a library test. */
	library: (name: string) => LibraryTestBuilder;
	/** Add a header test. */
	header: (name: string) => HeaderTestBuilder;
	/** Add a custom test. */
	custom: (test: Test) => TestBuilder;

	/** Build the test suite. */
	build: () => Promise<TestSuite>;
};

export type BinaryTestBuilder = {
	/** Test that the binary exists. */
	exists: () => TestBuilder;
	/** Test that the binary runs successfully. */
	runs: (args?: Array<string>) => TestBuilder;
	/** Test that the binary output matches a predicate. */
	outputMatches: (
		predicate: (stdout: string) => boolean,
		args?: Array<string>,
	) => TestBuilder;
};

export type LibraryTestBuilder = {
	/** Test that the static library exists. */
	staticlib: () => TestBuilder;
	/** Test that the dynamic library exists. */
	dylib: () => TestBuilder;
	/** Test that the library can be linked. */
	canLink: () => TestBuilder;
	/** Test all library forms (staticlib, dylib, and linking). */
	all: () => TestBuilder;
};

export type HeaderTestBuilder = {
	/** Test that the header exists. */
	exists: () => TestBuilder;
	/** Test that the header can be included and compiled. */
	canInclude: () => TestBuilder;
};

/** Create a composable test builder for a package directory. */
export const test = (directory: tg.Directory): TestBuilder => {
	// Mutable state for the builder
	const state = {
		directory,
		env: undefined as std.env.Arg | undefined,
		host: undefined as string | undefined,
		paths: defaultPaths,
		bootstrapMode: false,
		tests: [] as Array<Test>,
	};

	const builder: TestBuilder = {
		withEnv: (env: std.env.Arg) => {
			state.env = env;
			return builder;
		},

		withHost: (host: string) => {
			state.host = host;
			return builder;
		},

		withPaths: (paths: Partial<PathConfig>) => {
			state.paths = { ...state.paths, ...paths };
			return builder;
		},

		withBootstrap: (enabled: boolean) => {
			state.bootstrapMode = enabled;
			return builder;
		},

		binary: (name: string) => {
			const binaryBuilder: BinaryTestBuilder = {
				exists: () => {
					state.tests.push({
						name: `binary ${name} exists`,
						run: async (ctx) => {
							return await fileExists({
								directory: ctx.directory,
								subpath: `${ctx.paths.binDir}/${name}`,
							});
						},
					});
					return builder;
				},

				runs: (args?: Array<string>) => {
					state.tests.push({
						name: `binary ${name} runs`,
						run: async (ctx) => {
							return await runnableBin({
								directory: ctx.directory,
								binary: {
									name,
									testArgs: args ?? ["--version"],
								},
								env: ctx.env,
								host: ctx.host,
							});
						},
					});
					return builder;
				},

				outputMatches: (
					predicate: (stdout: string) => boolean,
					args?: Array<string>,
				) => {
					state.tests.push({
						name: `binary ${name} output matches predicate`,
						run: async (ctx) => {
							return await runnableBin({
								directory: ctx.directory,
								binary: {
									name,
									testArgs: args ?? ["--version"],
									testPredicate: predicate,
								},
								env: ctx.env,
								host: ctx.host,
							});
						},
					});
					return builder;
				},
			};
			return binaryBuilder;
		},

		library: (name: string) => {
			const libraryBuilder: LibraryTestBuilder = {
				staticlib: () => {
					state.tests.push({
						name: `library ${name} staticlib exists`,
						run: async (ctx) => {
							return await fileExists({
								directory: ctx.directory,
								subpath: `${ctx.paths.libDir}/lib${name}.a`,
							});
						},
					});
					return builder;
				},

				dylib: () => {
					state.tests.push({
						name: `library ${name} dylib exists`,
						run: async (ctx) => {
							const hostOs = std.triple.os(ctx.host);
							const ext = hostOs === "darwin" ? "dylib" : "so";
							return await fileExists({
								directory: ctx.directory,
								subpath: `${ctx.paths.libDir}/lib${name}.${ext}`,
							});
						},
					});
					return builder;
				},

				canLink: () => {
					state.tests.push({
						name: `library ${name} can link`,
						run: async (ctx) => {
							return await linkableLib({
								directory: ctx.directory,
								library: { name },
								env: ctx.env,
								host: ctx.host,
							});
						},
					});
					return builder;
				},

				all: () => {
					libraryBuilder.staticlib();
					libraryBuilder.dylib();
					libraryBuilder.canLink();
					return builder;
				},
			};
			return libraryBuilder;
		},

		header: (name: string) => {
			const headerBuilder: HeaderTestBuilder = {
				exists: () => {
					state.tests.push({
						name: `header ${name} exists`,
						run: async (ctx) => {
							return await fileExists({
								directory: ctx.directory,
								subpath: `${ctx.paths.includeDir}/${name}`,
							});
						},
					});
					return builder;
				},

				canInclude: () => {
					state.tests.push({
						name: `header ${name} can be included`,
						run: async (ctx) => {
							return await headerCanBeIncluded({
								directory: ctx.directory,
								header: name,
								env: ctx.env,
							});
						},
					});
					return builder;
				},
			};
			return headerBuilder;
		},

		custom: (test: Test) => {
			state.tests.push(test);
			return builder;
		},

		build: async () => {
			// Ensure host is set
			const host = state.host ?? (await std.triple.host());

			// Create the context that will be passed to all tests
			const context: TestContext = {
				directory: state.directory,
				env: state.env,
				host,
				paths: state.paths,
				bootstrapMode: state.bootstrapMode,
			};

			// Wrap each test to bind the context
			const testsWithContext: Array<Test> = state.tests.map((t) => ({
				name: t.name,
				run: async () => t.run(context),
			}));

			return {
				tests: testsWithContext,
				parallel: true,
			};
		},
	};

	return builder;
};

// ========== Simplified API Functions ==========

/** Simple assertion function that runs tests and throws if any fail. */
export const assertPackage = async (
	directory: tg.Directory,
	...tests: Array<Test>
): Promise<TestResults> => {
	const results = await runTests({ tests, parallel: true });
	if (results.failed > 0) {
		const failures = results.results
			.filter((r) => !r.passed)
			.map((r) => `  - ${r.test.name}: ${r.error}`)
			.join("\n");
		throw new Error(
			`Package assertion failed (${results.failed}/${results.total} tests failed):\n${failures}`,
		);
	}
	return results;
};

/** Convert a PackageSpec to a TestSuite using the composable builder. */
export const fromSpec = async (
	directory: tg.Directory,
	spec: PackageSpec,
): Promise<TestSuite> => {
	const builder = test(directory);

	// Configure builder from spec
	if (spec.env) {
		builder.withEnv(spec.env);
	}
	if (spec.bootstrapMode) {
		builder.withBootstrap(spec.bootstrapMode);
	}

	// Add binary tests
	if (spec.binaries) {
		for (const binarySpec of spec.binaries) {
			if (typeof binarySpec === "string") {
				builder.binary(binarySpec).runs();
			} else {
				const name = binarySpec.name;
				if (binarySpec.testPredicate) {
					builder
						.binary(name)
						.outputMatches(binarySpec.testPredicate, binarySpec.testArgs);
				} else {
					builder.binary(name).runs(binarySpec.testArgs);
				}
			}
		}
	}

	// Add header tests
	if (spec.headers) {
		for (const header of spec.headers) {
			builder.header(header).canInclude();
		}
	}

	// Add library tests
	if (spec.libraries) {
		for (const librarySpec of spec.libraries) {
			if (typeof librarySpec === "string") {
				builder.library(librarySpec).all();
			} else {
				const name = librarySpec.name;
				const libBuilder = builder.library(name);

				// Add specific library tests based on spec
				if (librarySpec.staticlib ?? true) {
					libBuilder.staticlib();
				}
				if (librarySpec.dylib ?? true) {
					libBuilder.dylib();
				}
				// Always test linking for libraries
				libBuilder.canLink();
			}
		}
	}

	// Add documentation file existence tests
	if (spec.docs) {
		for (const docPath of spec.docs) {
			builder.custom({
				name: `doc ${docPath} exists`,
				run: async (ctx) => {
					return await fileExists({
						directory: ctx.directory,
						subpath: `${ctx.paths.shareDir}/${docPath}`,
					});
				},
			});
		}
	}

	return await builder.build();
};

/** Convenience function that builds and runs tests in one call. Throws on failure. */
export const testPackage = async (
	directory: tg.Directory,
	builderFn: (builder: TestBuilder) => TestBuilder | void,
): Promise<TestResults> => {
	const builder = test(directory);
	builderFn(builder);
	const suite = await builder.build();
	return await assertPackage(directory, ...suite.tests);
};

// ========== Legacy API (Preserved for Backward Compatibility) ==========

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
			// /** The expected output of the binary when run with testArgs. If unspecified, just assert a 0 exit code. */
			testPredicate?: (stdout: string) => boolean;
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
			runtimeDeps?: Array<RuntimeDep>;
			/** What symbols should we expect this library to provide? */
			symbols?: Array<string>;
	  };

export type RuntimeDep = {
	directory: tg.Directory;
	libs: Array<string>;
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
			let library;
			if (typeof lib === "string") {
				library = {
					name: lib,
					pkgConfigName: lib,
					dylib: true,
					staticlib: true,
					runtimeDeps: [],
				};
			} else {
				library = {
					name: lib.name,
					pkgConfigName: lib.pkgConfigName ?? lib.name,
					dylib: lib.dylib ?? true,
					staticlib: lib.staticlib ?? true,
					runtimeDeps: lib.runtimeDeps ?? [],
				};
			}
			if (library) {
				tests.push(linkableLib({ directory, env, host, library }));
			}
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
	let testPredicate;
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
		if (arg.binary.testPredicate) {
			testPredicate = arg.binary.testPredicate;
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
	if (testPredicate !== undefined) {
		tg.assert(
			testPredicate(stdout),
			`Binary ${name} did not produce expected output. Received: ${stdout}`,
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
	let host = arg.host;
	let dylib = true;
	let staticlib = true;
	const env = arg.env ?? {};
	const sdk = arg.sdk;
	let runtimeDeps: Array<RuntimeDep> = [];
	if (typeof arg.library === "string") {
		name = arg.library;
	} else {
		name = arg.library.name;
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

	// Check for the pkg-config file if requested.
	if (pkgConfigName !== undefined) {
		tests.push(
			fileExists({
				directory: arg.directory,
				subpath: `lib/pkgconfig/${pkgConfigName}.pc`,
			}),
		);
	}

	// Check for the dylib if requested.
	if (dylib) {
		const dylibName_ = dylibName(name);
		const runtimeDepDirs = runtimeDeps.map((dep) => dep.directory);
		const runtimeDepLibs = runtimeDeps.flatMap((dep) =>
			dep.libs.map(dylibName),
		);
		tests.push(
			fileExists({
				directory: arg.directory,
				subpath: `lib/${dylibName_}`,
			}).then(() =>
				dlopen({
					directory: arg.directory,
					dylib: dylibName_,
					env,
					host,
					runtimeDepDirs,
					runtimeDepLibs,
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
			}),
		);
	}

	await Promise.all(tests);
	return true;
};

type DlopenArg = {
	directory: tg.Directory;
	dylib: string;
	env?: std.env.Arg;
	host: string;
	runtimeDepDirs: Array<tg.Directory>;
	runtimeDepLibs: Array<string>;
	sdk?: std.sdk.Arg;
};

/** Build and run a small program that dlopens the given dylib. */
export const dlopen = async (arg: DlopenArg) => {
	if (arg.host != (await std.triple.host())) {
		throw new Error("unsupported");
	}
	const directory = arg.directory;
	const dylibs = [arg.dylib, ...arg.runtimeDepLibs];

	const testCode = dylibs
		.map(
			(name, i) => `
		void* handle_${i} = dlopen("${name}", RTLD_NOW);
			if (!handle_${i}) {
				return -1;
			}
			dlclose(handle_${i});`,
		)
		.join("\n");

	// Generate the source.
	const source = tg.file`
		#include <dlfcn.h>
		int main() {
			${testCode}
			return 0;
		}`;

	// Compile the program.
	const linkerFlags = dylibs.map((name) => `-l${baseName(name)}`).join(" ");
	const sdkEnv = std.sdk(arg?.sdk);
	await $`cc -v -xc "${source}" ${linkerFlags} -o $OUTPUT`
		.bootstrap(true)
		.env(
			std.env.arg(
				sdkEnv,
				directory,
				...arg.runtimeDepDirs,
				{
					TGLD_TRACING: "tgld=trace",
				},
				arg.env,
				{ utils: false },
			),
		)
		.host(arg.host)
		.then(tg.File.expect);

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
		testPredicate: (stdout: string) => stdout.includes(version),
	};
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
