import * as std from "./tangram.ts";
import {
	fileOrSymlinkFromManifestTemplate,
	manifestDependencies,
	wrap,
} from "./wrap.tg.ts";

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
	/** The support build platforms (arch-os pairs) for producing this package. If not provided, assumes all supported Tangram platorms. */
	buildPlatforms?: Array<string>;
	/** The supported host platforms (arch-os pairs) for the output of this package. If not provided, assumes all supported Tangram platforms. */
	hostPlatforms?: Array<string>;
};

/** Assert a package contains the specified contents in the conventional locations.  As a packager, it's your responsibility to post-process your package's results to conform to this convention for use in the Tangram ecosystem. */
export const pkg = async <T extends std.args.PackageArg>(
	/** The function that builds the package directory. */
	buildCmd: std.args.BuildCommand<T>,
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
			const host = packageArg.host ?? (await std.triple.host());
			let directory = await std.args.buildCommandOutput(buildCmd, packageArg);
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
export const fileExists = tg.target(async (arg: FileExistsArg) => {
	const maybeFile = await arg.directory.tryGet(arg.subpath);
	tg.assert(maybeFile, `Path ${arg.subpath} does not exist.`);
	tg.File.assert(maybeFile);
	return true;
});

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

	const stdout = await tg
		.target(executable, {
			env: std.env.arg(arg.env),
			host: arg.host,
		})
		.then((target) => target.output())
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
	const interpreterId = await interpreterArtifact.id();
	tg.assert(interpreterId);
	let foundManifest = false;
	for await (const dependency of manifestDependencies(fileManifest)) {
		const dependencyId = await dependency.id();
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
		const referenceId = await dependency.id();
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
export const headerCanBeIncluded = tg.target(async (arg: HeaderArg) => {
	// Ensure the file exists.
	await fileExists({
		directory: arg.directory,
		subpath: `include/${arg.header}`,
	});

	// Generate a program that expects to include this header.
	const source = tg.file(`
		#include <${arg.header}>
		int main() {
			return 0;
		}
	`);

	// Compile the program, ensuring the env properly made the header discoverable.
	const program = await tg
		.target(tg`cc -xc "${source}" -o $OUTPUT`, {
			env: std.env.arg(std.sdk(), arg.directory),
		})
		.then((t) => t.output())
		.then(tg.File.expect);

	// Run the program.
	await tg.target(tg`${program}`).then((t) => t.output());
	return true;
});

type LibraryArg = {
	directory: tg.Directory;
	env?: std.env.Arg;
	host: string;
	library: LibrarySpec;
	sdk?: std.sdk.Arg;
};

/** Assert the directory contains a library conforming to the provided spec. */
export const linkableLib = tg.target(async (arg: LibraryArg) => {
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
		tests.push(async () => {
			// Combine internal libnames with external runtime dependency libnames.
			const dylibName_ = dylibName(name);

			// Assert the files exist.
			await fileExists({
				directory: arg.directory,
				subpath: `lib/${dylibName_}`,
			});

			// Assert it can be dlopened.
			const runtimeDepDirs = runtimeDeps.map((dep) => dep.directory);
			const runtimeDepLibs = runtimeDeps.flatMap((dep) =>
				dep.libs.map(dylibName),
			);
			await dlopen({
				directory: arg.directory,
				dylib: dylibName_,
				env,
				host,
				runtimeDepDirs,
				runtimeDepLibs,
				sdk,
			});
		});
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
});

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
	const source = tg.file(`
		#include <dlfcn.h>
		int main() {
			${testCode}
			return 0;
		}
	`);

	// Compile the program.
	const linkerFlags = dylibs.map((name) => `-l${baseName(name)}`).join(" ");
	const sdkEnv = std.sdk(arg?.sdk);
	await tg
		.target(tg`cc -v -xc "${source}" ${linkerFlags} -o $OUTPUT`, {
			env: std.env.arg(
				sdkEnv,
				directory,
				...arg.runtimeDepDirs,
				{
					TANGRAM_LINKER_TRACING: "tangram=trace",
				},
				arg.env,
			),
			host: arg.host,
		})
		.then((target) => target.output())
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
	const stdout = await tg
		.target(tg`${file} > $OUTPUT`, {
			env: {
				TANGRAM_WRAPPER_TRACING: "tangram=trace",
			},
		})
		.then((t) => t.output())
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
