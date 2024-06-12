import * as bootstrap from "./bootstrap.tg.ts";
import * as std from "./tangram.tg.ts";
import { $ } from "./tangram.tg.ts";
import { nativeProxiedSdkArgs } from "./sdk.tg.ts";
import { manifestReferences, wrap } from "./wrap.tg.ts";

type PkgArg = {
	/* A function that builds a package to check. If no other options are given, just asserts the package directory is non-empty. */
	buildFunction: (arg: {
		sdk?: std.sdk.Arg;
	}) => Promise<tg.Directory>;
	/* All executables that should exist under `bin/`, with optional behavior to check. */
	binaries?: Array<BinarySpec>;
	/* Any documentation files that should exist under `share/`. */
	docs?: Array<string>;
	/** Additional env to include when running tests. */
	env?: std.env.Arg;
	/* The names of all header files that should exist under `include/`. */
	headers?: Array<string>;
	/* All libraries that should exist under `lib/`. By default, checks for both staticlibs and dylibs */
	libraries?: Array<LibrarySpec>;
	/* Does the package provide an overall .pc file? */
	pkgConfigName?: string;
	/* Additional packages required at runtime to use this package. */
	runtimeDeps?: Array<RuntimeDep>;
	/** The metadata of the package being tested */
	metadata?: tg.Metadata;
	/** The SDK args to use for testing. Will be combined with `sdks` if present. If both are omitted, a default set will be tested. */
	sdk?: std.sdk.Arg;
	/** A list of sdk args to use for testing. Will be combined with `sdk`. If both are omitted, a default set will be tested. */
	sdks?: Array<std.sdk.Arg>;
};

/** Optionally specify some behavior for a particular binary. */
type BinarySpec =
	| string
	| {
			/** The name of the binary. */
			name: string;
			/** Arguments to pass. Defaults to `["--version"]`. */
			testArgs?: Array<string>;
			// /** The expected output of the binary when run with testArgs. If unspecified, just assert a 0 exit code. */
			testPredicate?: (stdout: string) => boolean;
			runtimeDeps?: Array<RuntimeDep>;
	  };

/** Optionally specify whether a particular library provides staticlibs, dylibs, or both. */
type LibrarySpec =
	| string
	| {
			name: string;
			dylib?: boolean;
			staticlib?: boolean;
			runtimeDeps?: Array<RuntimeDep>;
			symbols?: Array<string>;
	  };

type RuntimeDep = {
	directory: tg.Directory;
	libs: Array<string>;
};

/** Assert a package contains the specified contents in the conventional locations. As a packager, it's your responsibility to post-process your package's results to conform to this convention for use in the Tangram ecosystem. */
export let pkg = async (arg: PkgArg) => {
	//// Produce list of all requested SDK args.
	let sdks: Array<std.sdk.Arg> = [];
	if (arg.sdk) {
		sdks.push(arg.sdk);
	}
	if (arg.sdks) {
		sdks.push(...arg.sdks);
	}
	// If no SDK args were provided, test with the default set of SDKs for the platform.
	if (sdks.length === 0) {
		sdks.push(...(await defaultSdkSet()));
	}

	let env = arg.env ?? {};

	let metadata = arg.metadata;

	// Collect a seried of tests to run for each provided SDK.
	let tests = std.flatten(
		sdks.map(async (sdk) => {
			let directory = await arg.buildFunction({ sdk });

			// Collect tests to run in parallel. To start, always assert the package directory is non-empty.
			let tests = [nonEmpty(directory)];

			// Assert the package contains the specified binaries.
			if (arg.binaries) {
				for (let binarySpec of arg.binaries) {
					let binary =
						typeof binarySpec === "string"
							? { name: binarySpec, runtimeDeps: arg.runtimeDeps ?? [] }
							: binarySpec;
					tests.push(runnableBin({ directory, binary, env, metadata }));
				}
			}

			// Assert the package contains the specified documentation.
			if (arg.docs) {
				for (let docPath of arg.docs) {
					tests.push(
						assertFileExists({ directory, subpath: `share/${docPath}` }),
					);
				}
			}

			// Assert the package contains the specified headers.
			if (arg.headers) {
				for (let header of arg.headers) {
					tests.push(headerExists({ directory, header }));
					tests.push(headerCanBeIncluded({ directory, env, header }));
				}
			}

			// Assert the package contains the specified libraries.
			if (arg.libraries) {
				arg.libraries.forEach((lib) => {
					let library;
					if (typeof lib === "string") {
						library = {
							name: lib,
							dylib: true,
							staticlib: true,
							runtimeDeps: arg.runtimeDeps ?? [],
						};
					} else {
						library = {
							name: lib.name,
							dylib: lib.dylib ?? true,
							staticlib: lib.staticlib ?? true,
							runtimeDeps: lib.runtimeDeps ?? [],
						};
					}
					if (library) {
						tests.push(linkableLib({ directory, env, library, sdk }));
					}
				});
			}

			// Assert the toplevel pkg-config file exists.
			if (arg.pkgConfigName) {
				tests.push(
					assertFileExists({
						directory,
						subpath: `lib/pkgconfig/${arg.pkgConfigName}.pc`,
					}),
				);
			}
		}),
	);

	await Promise.all(tests);
	return true;
};

/** Assert the provided directory has contents. */
export let nonEmpty = async (dir: tg.Directory) => {
	let entries = await dir.entries();
	tg.assert(Object.keys(entries).length > 0, "Directory is empty.");
	return true;
};

type FileExistsArg = {
	directory: tg.Directory;
	subpath: string;
};

export let headerCanBeIncluded = tg.target(async (arg: HeaderArg) => {
	let maybeFile = await arg.directory.tryGet(arg.header);
	tg.assert(maybeFile, `Path ${arg.header} does not exist.`);
	tg.File.assert(maybeFile);

	let source = tg.file(`
		#include "${arg.header}"
		int main() {
			return 0;
		}
	`);

	await $`cp -r ${arg.directory}/* . && cc -xc "${source}" -o $OUTPUT`
		.env(bootstrap.sdk(), arg.directory, arg.env ?? {})
		.then(tg.File.expect);
	return true;
});

/** Assert the provided path exists and refers to a file. */
export let assertFileExists = tg.target(async (arg: FileExistsArg) => {
	let maybeFile = await arg.directory.tryGet(arg.subpath);
	tg.assert(maybeFile, `Path ${arg.subpath} does not exist.`);
	tg.File.assert(maybeFile);
	return true;
});

type RunnableBinArg = {
	directory: tg.Directory;
	binary: BinarySpec;
	env?: std.env.Arg | undefined;
	metadata?: tg.Metadata | undefined;
};

/** Assert the directory contains a binary conforming to the provided spec. */
export let runnableBin = async (arg: RunnableBinArg) => {
	let name;
	let testPredicate = (stdout: string) =>
		stdout.includes(arg.metadata?.version ?? "");
	let testArgs = ["--version"];
	let runtimeDeps;
	if (typeof arg.binary === "string") {
		name = arg.binary;
	} else {
		runtimeDeps = arg.binary.runtimeDeps;
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
	await assertFileExists({
		directory: arg.directory,
		subpath: `bin/${name}`,
	});

	let path = (runtimeDeps ?? [])
		.flatMap((dep) => dep.directory)
		.reduce((t, depDir) => {
			return tg`${t}:${depDir}`;
		}, tg``);
	let env = std.env(
		{
			PATH: path,
		},
		arg.env,
	);

	// Run the binary with the provided test invocation.
	let executable = tg`${arg.directory}/bin/${name} ${tg.Template.join(
		" ",
		...testArgs,
	)} > $OUTPUT 2>&1 || true`;

	let output = tg.File.expect(
		await (
			await tg.target(executable, { env: await std.env.arg(env) })
		).output(),
	);
	let stdout = await output.text();
	tg.assert(
		testPredicate(stdout),
		`Binary ${name} did not produce expected output. Received: ${stdout}`,
	);
	return true;
};

export let assertFileReferences = async (
	file: tg.File,
	interpreterKind: "normal" | "ld-musl" | "ld-linux",
) => {
	// Ensure the interpreter is found in the manifest references.
	let fileManifest = await wrap.Manifest.read(file);
	tg.assert(fileManifest);
	tg.assert(fileManifest.interpreter?.kind === interpreterKind);
	let interpreter = fileManifest.interpreter;
	let interpreterPath = interpreter.path;
	let interpreterId = interpreterPath.artifact;
	tg.assert(interpreterId);
	let foundManifest = false;
	for await (let reference of manifestReferences(fileManifest)) {
		let referenceId = await reference.id();
		if (referenceId === interpreterId) {
			foundManifest = true;
		}
	}
	tg.assert(
		foundManifest,
		"Could not find interpreter in manifest references.",
	);

	// Ensure the interpreter is found in the file references.
	let fileReferences = await file.references();
	tg.assert(fileReferences.length > 0, "No file references found.");
	let foundFile = false;
	for (let reference of fileReferences) {
		let referenceId = await reference.id();
		if (referenceId === interpreterId) {
			foundFile = true;
		}
	}
	tg.assert(foundFile, "Could not find interpreter in file references.");
};

type HeaderArg = {
	directory: tg.Directory;
	env?: std.env.Arg;
	header: string;
};

/** Assert the directory contains a header file with the provided name. */
export let headerExists = tg.target(async (arg: HeaderArg) => {
	// Ensure the file exists.
	await assertFileExists({
		directory: arg.directory,
		subpath: `include/${arg.header}`,
	});

	// Generate a program that expects to include this header.
	let source = tg.file(`
		#include <${arg.header}>
		int main() {
			return 0;
		}
	`);

	// Compile the program, ensuring the env properly made the header discoverable.
	let program = await $`env && cc -xc "${source}" -o $OUTPUT`
		.env(std.sdk(), arg.directory)
		.then(tg.File.expect);

	// Run the program.
	await $`${program}`;
	return true;
});

type LibraryArg = {
	directory: tg.Directory;
	env?: std.env.Arg;
	library: LibrarySpec;
	sdk?: std.sdk.Arg;
};

/** Assert the directory contains a library conforming to the provided spec. */
export let linkableLib = tg.target(async (arg: LibraryArg) => {
	let name;
	let dylib = true;
	let staticlib = true;
	let env = arg.env ?? {};
	let sdk = arg.sdk;
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

	let hostOs = std.triple.os(await std.triple.host());
	let dylibExtension = hostOs === "darwin" ? "dylib" : "so";

	let dylibName = (name: string) => `lib${name}.${dylibExtension}`;

	if (dylib) {
		// Combine internal libnames with external runtime dependency libnames.
		let dylibName_ = dylibName(name);

		// Assert the files exist.
		await assertFileExists({
			directory: arg.directory,
			subpath: `lib/${dylibName_}`,
		});

		// Assert it can be dlopened.
		let runtimeDepDirs = runtimeDeps.map((dep) => dep.directory);
		let runtimeDepLibs = runtimeDeps.flatMap((dep) => dep.libs.map(dylibName));
		await dlopen({
			directory: arg.directory,
			dylib: dylibName_,
			env,
			runtimeDepDirs,
			runtimeDepLibs,
			sdk,
		});
	}

	if (staticlib) {
		await assertFileExists({
			directory: arg.directory,
			subpath: `lib/lib${name}.a`,
		});
	}
	return true;
});

type DlopenArg = {
	directory: tg.Directory;
	dylib: string;
	env?: std.env.Arg;
	runtimeDepDirs: Array<tg.Directory>;
	runtimeDepLibs: Array<string>;
	sdk?: std.sdk.Arg;
};

/** Build and run a small program that dlopens the given dylib. */
export let dlopen = async (arg: DlopenArg) => {
	let directory = arg.directory;
	let dylibs = [arg.dylib, ...arg.runtimeDepLibs];

	let testCode = dylibs
		.map(
			(name) => `
		void* ${baseName(name)}Handle = dlopen("${name}", RTLD_NOW);
			if (!${baseName(name)}Handle) {
				return -1;
			}
			dlclose(${baseName(name)}Handle);`,
		)
		.join("\n");

	// Generate the source.
	let source = tg.file(`
		#include <dlfcn.h>
		int main() {
			${testCode}
			return 0;
		}
	`);

	// Compile the program.
	let linkerFlags = dylibs.map((name) => `-l${baseName(name)}`).join(" ");
	let sdkEnv = std.sdk(arg?.sdk);
	tg.File.expect(
		await (
			await tg.target(tg`cc -v -xc "${source}" ${linkerFlags} -o $OUTPUT`, {
				env: std.env.arg(
					sdkEnv,
					directory,
					...arg.runtimeDepDirs,
					{
						TANGRAM_LD_PROXY_TRACING: "tangram=trace",
					},
					arg.env,
				),
			})
		).output(),
	);

	return true;
};

/** Given a library filename, get the basename to pass to a compiler. Throws if no match. */
export let baseName = (lib: string): string => {
	let maybeBaseName = tryBaseName(lib);
	tg.assert(
		maybeBaseName,
		`Library name ${lib} does not match expected pattern.`,
	);
	return maybeBaseName;
};

/** Given a library filename, get the basename to pass to a compiler. Returns undefined if no match. */
export let tryBaseName = (lib: string): string | undefined => {
	let match = lib.match(/^lib(.*)\.(a|so|dylib)$/);
	if (!match) {
		return undefined;
	}
	return match[1];
};

/** Produce a set of SDK configurations to test for the given platform. */
let defaultSdkSet = async (): Promise<Array<std.sdk.Arg>> => {
	return nativeProxiedSdkArgs();
};
