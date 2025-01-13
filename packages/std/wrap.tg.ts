import * as bootstrap from "./bootstrap.tg.ts";
import * as gnu from "./sdk/gnu.tg.ts";
import { interpreterName } from "./sdk/libc.tg.ts";
import * as std from "./tangram.ts";
import * as injection from "./wrap/injection.tg.ts";
import * as workspace from "./wrap/workspace.tg.ts";
import inspectProcessSource from "./wrap/test/inspectProcess.c" with {
	type: "file",
};

export { ccProxy, ldProxy, wrapper } from "./wrap/workspace.tg.ts";

/** This module provides the `std.wrap()` function, which can be used to bundle an executable with a predefined environment and arguments, either of which may point to other Tangram artifacts.*/

/** Wrap an executable. */
export async function wrap(
	...args: std.args.UnresolvedArgs<wrap.Arg>
): Promise<tg.File> {
	const arg = await wrap.arg(...args);

	tg.assert(arg.executable !== undefined, "No executable was provided.");

	const executable = await manifestExecutableFromArg(arg.executable);

	const identity = arg.identity ?? "executable";

	const detectedBuild = await std.triple.host();
	const host = arg.host ?? (await std.triple.host());
	std.triple.assert(host);
	const buildToolchain = arg.buildToolchain
		? arg.buildToolchain
		: std.triple.os(host) === "linux"
			? await gnu.toolchain({ host: detectedBuild, target: host })
			: await bootstrap.sdk.env(host);

	const manifestInterpreter = arg.interpreter
		? await manifestInterpreterFromArg(arg.interpreter, buildToolchain)
		: await manifestInterpreterFromExecutableArg(
				arg.executable,
				buildToolchain,
			);

	// Ensure we're not building an identity=executable wrapper for an unwrapped statically-linked executable.
	if (
		identity === "executable" &&
		(executable instanceof tg.File || executable instanceof tg.Symlink)
	) {
		const file =
			executable instanceof tg.Symlink
				? await executable.resolve()
				: executable;
		if (!file || file instanceof tg.Directory) {
			return tg.unreachable(
				"Following the executable symlink either failed or returned a directory.",
			);
		}
		tg.File.assert(file);
		const metadata = await std.file.executableMetadata(file);
		if (metadata.format === "elf" && metadata.interpreter == undefined) {
			throw new Error(
				`Found a statically-linked executable but selected the "executable" identity.  This combination is not supported.  Please select the "wrapper" identity instead.`,
			);
		}
	}

	// Add remaining library paths.
	if (manifestInterpreter && "libraryPaths" in manifestInterpreter) {
		let paths = manifestInterpreter.libraryPaths ?? [];
		if (arg.libraryPaths) {
			paths = paths.concat(
				await Promise.all(arg.libraryPaths.map(manifestTemplateFromArg)),
			);
		}
		manifestInterpreter.libraryPaths = paths;
	}

	const manifestEnv = await wrap.manifestEnvFromEnvObject(
		arg.env as std.env.EnvObject,
	);
	const manifestArgs = await Promise.all(
		(arg.args ?? []).map(manifestTemplateFromArg),
	);

	const manifest: wrap.Manifest = {
		identity,
		interpreter: manifestInterpreter,
		executable,
		env: manifestEnv,
		args: manifestArgs,
	};

	// Get the wrapper executable.
	const detectedOs = std.triple.os(detectedBuild);
	const build =
		detectedOs === "linux"
			? await bootstrap.toolchainTriple(detectedBuild)
			: detectedBuild;
	const wrapper = await workspace.wrapper({
		buildToolchain,
		build,
		host,
	});

	// Write the manifest to the wrapper and return.
	return await wrap.Manifest.write(wrapper, manifest);
}

export default wrap;

export namespace wrap {
	export type Arg = string | tg.Template | tg.File | tg.Symlink | ArgObject;

	export type ArgObject = {
		/** Command line arguments to bind to the wrapper. If the executable is wrapped, they will be merged. */
		args?: Array<tg.Template.Arg>;

		/** The build toolchain to use to produce components. Will use the default for the system if not provided. */
		buildToolchain?: std.env.Arg;

		/** Environment variables to bind to the wrapper. If the executable is wrapped, they will be merged. */
		env?: std.env.Arg;

		/** The executable to wrap. */
		executable?: string | tg.Template | tg.File | tg.Symlink;

		/** The host system to produce a wrapper for. */
		host?: string;

		/** The identity of the executable. The default is "executable". */
		identity?: Identity;

		/** The interpreter to run the executable with. If not provided, a default is detected. */
		interpreter?: tg.File | tg.Symlink | tg.Template | Interpreter;

		/** Library paths to include. If the executable is wrapped, they will be merged. */
		libraryPaths?: Array<tg.Directory | tg.Symlink | tg.Template>;

		/** Specify how to handle executables that are already Tangram wrappers. When `merge` is true, retain the original executable in the resulting manifest. When `merge` is set to false, produce a manifest pointing to the original wrapper. This option is ignored if the executable being wrapped is not a Tangram wrapper. Default: true. */
		merge?: boolean;
	};

	export type Identity = "wrapper" | "interpreter" | "executable";

	/** Either a normal interpreter, ld-linux, ld-musl, or dyld. */
	export type Interpreter =
		| NormalInterpreter
		| LdLinuxInterpreter
		| LdMuslInterpreter
		| DyLdInterpreter;

	export type NormalInterpreter = {
		/** The interpreter executable. */
		executable: tg.File | tg.Symlink;

		/** Additional arguments to pass to the interpreter. */
		args?: Array<tg.Template.Arg> | undefined;
	};

	export type LdLinuxInterpreter = {
		kind: "ld-linux";

		/** The ld-linux file. */
		executable: tg.File | tg.Symlink;

		/** Additional library paths to include. */
		libraryPaths?: Array<tg.Template.Arg> | undefined;

		/** Additional preloads to load. */
		preloads?: Array<tg.Template.Arg> | undefined;

		/** Additional arguments to pass to the interpreter. */
		args?: Array<tg.Template.Arg> | undefined;
	};

	export type LdMuslInterpreter = {
		kind: "ld-musl";

		/** The ld-musl file. */
		executable: tg.File | tg.Symlink;

		/** Additional library paths to include. */
		libraryPaths?: Array<tg.Template.Arg> | undefined;

		/** Additional preloads to load. */
		preloads?: Array<tg.Template.Arg> | undefined;

		/** Additional arguments to pass to the interpreter. */
		args?: Array<tg.Template.Arg> | undefined;
	};

	export type DyLdInterpreter = {
		kind: "dyld";

		/** Additional library paths to include. */
		libraryPaths?: Array<tg.Template.Arg> | undefined;

		/** Additional preloads to load. */
		preloads?: Array<tg.Template.Arg> | undefined;
	};

	export type Manifest = {
		identity: Identity;
		interpreter?: Manifest.Interpreter | undefined;
		executable: Manifest.Executable;
		env?: Manifest.Mutation | undefined;
		args?: Array<Manifest.Template> | undefined;
	};

	/** Process variadic arguments. */
	export const arg = async (...args: std.args.UnresolvedArgs<wrap.Arg>) => {
		const objectArgs = await Promise.all(
			std.flatten(await Promise.all(args.map(tg.resolve))).map(async (arg) => {
				if (arg === undefined) {
					return {};
				} else if (arg instanceof tg.File || arg instanceof tg.Symlink) {
					return { executable: arg };
				} else if (typeof arg === "string" || arg instanceof tg.Template) {
					// This is a "content" executable.
					const defaultShell = await defaultShellInterpreter();
					return {
						identity: "interpreter" as const,
						interpreter: defaultShell,
						executable: arg,
					};
				} else if (isArgObject(arg)) {
					return arg;
				} else {
					return tg.unreachable(`Unsupported argument: ${arg}`);
				}
			}),
		);
		const mutationArgs = await std.args.createMutations<
			std.wrap.ArgObject,
			std.args.MakeArrayKeys<std.wrap.ArgObject, "env">
		>(objectArgs, {
			env: "append",
			libraryPaths: "append",
			args: "append",
		});
		let {
			args: args_,
			buildToolchain,
			env: env_ = [],
			executable,
			host,
			identity,
			interpreter,
			merge: merge_ = true,
			libraryPaths,
		} = await std.args.applyMutations(mutationArgs);

		tg.assert(executable !== undefined);

		// If the executable arg is a wrapper, obtain its manifest.
		const existingManifest =
			await wrap.existingManifestFromExecutableArg(executable);

		// Determine whether to try to merge this wrapper with an existing one. If the user specified `true`, only honor if an existing manifest was found.
		const merge = merge_ && existingManifest !== undefined;

		// If the executable is a file and the behavior is merge, try to read the manifest from it.
		if (merge) {
			if (existingManifest === undefined) {
				const dbg = tg.Artifact.is(executable)
					? await executable.id()
					: executable;
				throw new Error(
					`Could not locate existing manifest to merge with.  Received ${dbg}.`,
				);
			}

			env_ = [await wrap.envArgFromManifestEnv(existingManifest.env), ...env_];
			identity = existingManifest.identity;
			interpreter = await wrap.interpreterFromManifestInterpreter(
				existingManifest.interpreter,
			);
			executable = await wrap.executableFromManifestExecutable(
				existingManifest.executable,
			);
			args_ = (args_ ?? []).concat(
				await Promise.all(
					(existingManifest.args ?? []).map(templateFromManifestTemplate),
				),
			);
		}

		const env = await std.env.arg(...env_);

		// If the executable is a content executable, make sure there is a normal interpreter for it and sensible identity.
		if (executable instanceof tg.Template || typeof executable === "string") {
			if (interpreter === undefined) {
				interpreter = await defaultShellInterpreter();
			}
			if (identity === undefined) {
				identity = "interpreter" as const;
			}
			if (identity === "executable") {
				throw new Error(
					"cannot use the executable identity with content executables, select interpreter or wrapper",
				);
			}
		}

		return {
			args: args_,
			buildToolchain,
			env,
			executable,
			host,
			identity,
			interpreter,
			merge,
			libraryPaths,
		};
	};

	export const envArgFromManifestEnv = async (
		mutation: wrap.Manifest.Mutation | undefined,
	): Promise<std.env.ArgObject> => {
		const ret: std.env.EnvObject = {};
		if (mutation?.kind !== "set") {
			return ret;
		}
		tg.assert(mutation.kind === "set", "Malformed env, expected set or unset.");
		return envArgFromMapValue(mutation.value);
	};

	export const interpreterFromManifestInterpreter = async (
		manifestInterpreter: wrap.Manifest.Interpreter | undefined,
	): Promise<wrap.Interpreter | undefined> => {
		if (manifestInterpreter === undefined) {
			return undefined;
		}
		switch (manifestInterpreter.kind) {
			case "normal": {
				return {
					executable: await fileOrSymlinkFromManifestTemplate(
						manifestInterpreter.path,
					),
					args:
						manifestInterpreter.args === undefined
							? undefined
							: await Promise.all(
									manifestInterpreter.args.map(templateFromManifestTemplate),
								),
				};
			}
			case "ld-linux": {
				return {
					kind: "ld-linux",
					executable: await fileOrSymlinkFromManifestTemplate(
						manifestInterpreter.path,
					),
					libraryPaths:
						manifestInterpreter.libraryPaths === undefined
							? undefined
							: await Promise.all(
									manifestInterpreter.libraryPaths.map(
										templateFromManifestTemplate,
									),
								),
					preloads:
						manifestInterpreter.preloads === undefined
							? undefined
							: await Promise.all(
									manifestInterpreter.preloads.map(
										fileOrSymlinkFromManifestTemplate,
									),
								),
					args:
						manifestInterpreter.args === undefined
							? undefined
							: await Promise.all(
									manifestInterpreter.args.map(templateFromManifestTemplate),
								),
				};
			}
			case "ld-musl": {
				return {
					kind: "ld-musl",
					executable: await fileOrSymlinkFromManifestTemplate(
						manifestInterpreter.path,
					),
					libraryPaths:
						manifestInterpreter.libraryPaths === undefined
							? undefined
							: await Promise.all(
									manifestInterpreter.libraryPaths.map(
										templateFromManifestTemplate,
									),
								),
					preloads:
						manifestInterpreter.preloads === undefined
							? undefined
							: await Promise.all(
									manifestInterpreter.preloads.map(
										fileOrSymlinkFromManifestTemplate,
									),
								),
					args:
						manifestInterpreter.args === undefined
							? undefined
							: await Promise.all(
									manifestInterpreter.args.map(templateFromManifestTemplate),
								),
				};
			}
			case "dyld": {
				return {
					kind: "dyld",
					libraryPaths:
						manifestInterpreter.libraryPaths === undefined
							? undefined
							: await Promise.all(
									manifestInterpreter.libraryPaths.map(
										templateFromManifestTemplate,
									),
								),
					preloads:
						manifestInterpreter.preloads === undefined
							? undefined
							: await Promise.all(
									manifestInterpreter.preloads.map(
										fileOrSymlinkFromManifestTemplate,
									),
								),
				};
			}
			default: {
				return tg.unreachable(`Unexpected interpreter ${manifestInterpreter}`);
			}
		}
	};

	/** Utility to retrieve the existing manifest from an exectuable arg, if it's a wrapper. If not, returns `undefined`. */
	export const existingManifestFromExecutableArg = async (
		executable: undefined | string | tg.Template | tg.File | tg.Symlink,
	): Promise<wrap.Manifest | undefined> => {
		let ret = undefined;
		if (executable instanceof tg.File || executable instanceof tg.Symlink) {
			const f =
				executable instanceof tg.Symlink
					? await executable.resolve()
					: executable;
			if (f instanceof tg.File) {
				const manifest = await wrap.Manifest.read(f);
				if (manifest) {
					ret = manifest;
				}
			}
		}
		return ret;
	};

	export const executableFromManifestExecutable = async (
		manifestExecutable: wrap.Manifest.Executable,
	): Promise<tg.Template | tg.File | tg.Symlink> => {
		if (manifestExecutable.kind === "content") {
			return templateFromManifestTemplate(manifestExecutable.value);
		} else {
			return fileOrSymlinkFromManifestTemplate(manifestExecutable.value);
		}
	};

	export const manifestEnvFromEnvObject = async (
		envObject: std.env.EnvObject,
	): Promise<wrap.Manifest.Mutation | undefined> => {
		const value = await std.env.arg(envObject).then(manifestValueFromValue);
		tg.assert(
			!Array.isArray(value),
			`Expected a single value, but got an array: ${value}`,
		);
		if (value === undefined) {
			return undefined;
		}
		tg.assert(
			typeof value === "object" && "kind" in value && value.kind === "map",
			`Expected a map, but got ${value}.`,
		);
		return { kind: "set", value };
	};

	/** Attempt to unwrap a wrapped executable. Returns undefined if the input was not a Tangram wrapper. */
	export const tryUnwrap = async (
		file: tg.File,
	): Promise<tg.Symlink | tg.File | tg.Template | undefined> => {
		try {
			return await unwrap(file);
		} catch (_) {
			return undefined;
		}
	};

	/** Unwrap a wrapped executable. Throws an error if the input was not a Tangram executable. */
	export const unwrap = async (
		file: tg.File,
	): Promise<tg.Symlink | tg.File | tg.Template> => {
		const manifest = await wrap.Manifest.read(file);
		if (!manifest) {
			throw new Error(
				`Cannot unwrap ${await file.id()}: not a Tangram wrapper.`,
			);
		}
		if (manifest.executable.kind === "content") {
			return templateFromManifestTemplate(manifest.executable.value);
		} else {
			return fileOrSymlinkFromManifestTemplate(manifest.executable.value);
		}
	};

	export namespace Manifest {
		export type Identity = "wrapper" | "interpreter" | "executable";

		export type Interpreter =
			| NormalInterpreter
			| LdLinuxInterpreter
			| LdMuslInterpreter
			| DyLdInterpreter;

		export type NormalInterpreter = {
			kind: "normal";
			path: Manifest.Template;
			args?: Array<Manifest.Template> | undefined;
		};

		export type LdLinuxInterpreter = {
			kind: "ld-linux";
			path: Manifest.Template;
			libraryPaths?: Array<Manifest.Template> | undefined;
			preloads?: Array<Manifest.Template> | undefined;
			args?: Array<Manifest.Template> | undefined;
		};

		export type LdMuslInterpreter = {
			kind: "ld-musl";
			path: Manifest.Template;
			libraryPaths?: Array<Manifest.Template> | undefined;
			preloads?: Array<Manifest.Template> | undefined;
			args?: Array<Manifest.Template> | undefined;
		};

		export type DyLdInterpreter = {
			kind: "dyld";
			libraryPaths?: Array<Manifest.Template> | undefined;
			preloads?: Array<Manifest.Template> | undefined;
		};

		export type Executable =
			| { kind: "path"; value: Manifest.Template }
			| { kind: "content"; value: Manifest.Template };

		// Matches tg::template::Data
		export type Template = {
			components: Array<Manifest.Template.Component>;
		};

		// Matches tg::template::component::Data
		export namespace Template {
			export type Component =
				| { kind: "string"; value: string }
				| { kind: "artifact"; value: tg.Artifact.Id };
		}

		// Matches tg::mutation::Data
		export type Mutation =
			| { kind: "unset" }
			| { kind: "set"; value: Manifest.Value }
			| { kind: "set_if_unset"; value: Manifest.Value }
			| {
					kind: "prefix";
					template: Manifest.Template;
					separator?: string | undefined;
			  }
			| {
					kind: "suffix";
					template: Manifest.Template;
					separator?: string | undefined;
			  }
			| { kind: "prepend"; values: Array<Manifest.Value> }
			| { kind: "append"; values: Array<Manifest.Value> };

		// Matches tg::value::Data
		export type Value =
			| undefined
			| boolean
			| number
			| string
			| { kind: "directory"; value: tg.Directory.Id }
			| { kind: "file"; value: tg.File.Id }
			| { kind: "symlink"; value: tg.Symlink.Id }
			| { kind: "template"; value: Manifest.Template }
			| { kind: "mutation"; value: Manifest.Mutation }
			| { kind: "map"; value: { [key: string]: Manifest.Value } }
			| Array<Manifest.Value>;

		// The non-serializeable type of a normalized env.
		export type Env = tg.Mutation<std.env.EnvObject>;

		/** Read a manifest from the end of a file. */
		export const read = async (
			file: tg.File,
		): Promise<wrap.Manifest | undefined> => {
			// Read the file.
			const fileBytes = await file.bytes();
			let filePosition = fileBytes.length;

			// Read and verify the magic number.
			filePosition -= MANIFEST_MAGIC_NUMBER.length;
			const magicNumberBytes = fileBytes.slice(-MANIFEST_MAGIC_NUMBER.length);
			for (let i = 0; i < MANIFEST_MAGIC_NUMBER.length; i++) {
				if (magicNumberBytes[i] !== MANIFEST_MAGIC_NUMBER[i]) {
					return undefined;
				}
			}

			// Read and verify the version.
			filePosition -= MANIFEST_MAGIC_NUMBER.length;
			const version = Number(
				new DataView(fileBytes.buffer).getBigUint64(filePosition, true),
			);
			if (version !== MANIFEST_VERSION) {
				return undefined;
			}

			// Read the manifest length.
			filePosition -= 8;
			const manifestLength = Number(
				new DataView(fileBytes.buffer).getBigUint64(filePosition, true),
			);

			// Read the manifest.
			filePosition -= manifestLength;
			const manifestBytes = fileBytes.slice(
				filePosition,
				filePosition + manifestLength,
			);

			// Deserialize the manifest.
			const manifest = tg.encoding.json.decode(
				tg.encoding.utf8.decode(manifestBytes),
			) as wrap.Manifest;

			return manifest;
		};

		/** Write a manifest to a file. */
		export const write = async (file: tg.File, manifest: wrap.Manifest) => {
			// Serialize the manifest.
			const manifestBytes = tg.encoding.utf8.encode(
				tg.encoding.json.encode(manifest),
			);

			// Retrieve the file's blob.
			const fileBlob = file.contents();

			// Create a buffer for the manifest plus three 64-bit values (manifest length, version, magic number).
			const newBytesLength = manifestBytes.length + 8 + 8 + 8;
			let newBytesPosition = 0;
			const littleEndian = true;
			const newBytes = new Uint8Array(newBytesLength);

			// Write the manifest.
			newBytes.set(manifestBytes, newBytesPosition);
			newBytesPosition += manifestBytes.length;

			// Write the length of the manifest.
			new DataView(newBytes.buffer).setBigUint64(
				newBytesPosition,
				BigInt(manifestBytes.length),
				littleEndian,
			);
			newBytesPosition += 8;

			// Write the version.
			new DataView(newBytes.buffer).setBigUint64(
				newBytesPosition,
				BigInt(MANIFEST_VERSION),
				littleEndian,
			);
			newBytesPosition += 8;

			// Write the magic number.
			newBytes.set(MANIFEST_MAGIC_NUMBER, newBytesPosition);
			newBytesPosition += 8;

			// Create the blob.
			const contents = tg.blob(fileBlob, newBytes);

			// Collect the manifest references.
			const dependencies_ = new Set<tg.Object.Id>();
			for await (const dependencies of manifestDependencies(manifest)) {
				dependencies_.add(await dependencies.id());
			}
			const fileDependencies = await file.dependencyObjects();
			await Promise.all(
				fileDependencies.map(async (reference) => {
					dependencies_.add(await reference.id());
				}),
			);
			const dependencies: { [reference: string]: tg.Referent<tg.Object> } = {};
			for (const dependency of dependencies_) {
				dependencies[dependency] = { item: tg.Object.withId(dependency) };
			}

			// Create the file.
			const newFile = tg.file({
				contents,
				dependencies,
				executable: true,
			});

			return newFile;
		};
	}
}

const isArgObject = (arg: unknown): arg is wrap.ArgObject => {
	return (
		typeof arg === "object" &&
		!(
			arg instanceof tg.File ||
			arg instanceof tg.Symlink ||
			arg instanceof tg.Template
		)
	);
};

/** The magic number is `tangram\0`. */
const MANIFEST_MAGIC_NUMBER: Uint8Array = new Uint8Array([
	116, 97, 110, 103, 114, 97, 109, 0,
]);

const MANIFEST_VERSION = 0;

const manifestExecutableFromArg = async (
	arg: string | tg.Template | tg.File | tg.Symlink | wrap.Manifest.Executable,
): Promise<wrap.Manifest.Executable> => {
	if (isManifestExecutable(arg)) {
		return arg;
	} else if (arg instanceof tg.File || arg instanceof tg.Symlink) {
		const value = await manifestTemplateFromArg(arg);
		tg.assert(value);
		return {
			kind: "path",
			value,
		};
	} else if (typeof arg === "string" || arg instanceof tg.Template) {
		return {
			kind: "content",
			value: await manifestTemplateFromArg(arg),
		};
	} else {
		return tg.unreachable();
	}
};

const isManifestExecutable = (
	arg: unknown,
): arg is wrap.Manifest.Executable => {
	return (
		arg !== undefined &&
		arg !== null &&
		typeof arg === "object" &&
		"kind" in arg &&
		(arg.kind === "path" || arg.kind === "content")
	);
};

const manifestInterpreterFromArg = async (
	arg:
		| tg.File
		| tg.Symlink
		| tg.Template
		| wrap.Interpreter
		| wrap.Manifest.Interpreter,
	buildToolchainArg?: std.env.Arg,
): Promise<wrap.Manifest.Interpreter> => {
	if (isManifestInterpreter(arg)) {
		return arg;
	}

	// If the arg is an executable, then wrap it and create a normal interpreter.
	if (
		arg instanceof tg.File ||
		arg instanceof tg.Symlink ||
		arg instanceof tg.Template
	) {
		const interpreter = await std.wrap({
			buildToolchain: buildToolchainArg,
			executable: arg,
		});
		const path = await manifestTemplateFromArg(interpreter);
		return {
			kind: "normal",
			path,
			args: [],
		};
	}

	// Otherwise, create the interpreter specified by the arg object.
	if ("kind" in arg && arg.kind === "ld-linux") {
		// Handle an ld-linux interpreter.
		const path = await manifestTemplateFromArg(arg.executable);
		const libraryPaths = arg.libraryPaths
			? await Promise.all(
					arg.libraryPaths.map(async (arg) =>
						manifestTemplateFromArg(await tg.template(arg)),
					),
				)
			: undefined;

		// Build an injection dylib to match the interpreter.
		const interpreterFile =
			arg.executable instanceof tg.Symlink
				? await arg.executable.resolve()
				: arg.executable;
		if (!interpreterFile || interpreterFile instanceof tg.Directory) {
			throw new Error("Could not resolve the symlink to the interpreter.");
		}
		tg.File.assert(interpreterFile);
		const interpreterMetadata =
			await std.file.executableMetadata(interpreterFile);
		if (interpreterMetadata.format !== "elf") {
			return tg.unreachable(
				"Cannot build an ld-linux interpreter for a non-ELF executable.",
			);
		}

		const preloads = arg.preloads
			? await Promise.all(
					arg.preloads?.map(async (arg) =>
						manifestTemplateFromArg(await tg.template(arg)),
					),
				)
			: [];

		// If no preload is defined, add the default injection preload.
		if (preloads.length === 0) {
			const arch = interpreterMetadata.arch;
			const host = `${arch}-unknown-linux-gnu`;
			const detectedBuild = await std.triple.host();
			const buildOs = std.triple.os(detectedBuild);
			const buildToolchain = buildToolchainArg
				? buildToolchainArg
				: gnu.toolchain({ host });
			const injectionLibrary = await injection.default({
				buildToolchain,
				build: buildOs === "darwin" ? detectedBuild : undefined,
				host,
			});

			const injectionManifestSymlink =
				await manifestTemplateFromArg(injectionLibrary);
			preloads.push(injectionManifestSymlink);
		}

		const args = arg.args
			? await Promise.all(arg.args.map(manifestTemplateFromArg))
			: undefined;
		return {
			kind: "ld-linux",
			path,
			libraryPaths,
			preloads,
			args,
		};
	} else if ("kind" in arg && arg.kind === "ld-musl") {
		// Handle an ld-musl interpreter.
		const path = await manifestTemplateFromArg(arg.executable);
		const libraryPaths = arg.libraryPaths
			? await Promise.all(
					arg.libraryPaths.map(async (arg) =>
						manifestTemplateFromArg(await tg.template(arg)),
					),
				)
			: undefined;

		// Build an injection dylib to match the interpreter.
		const interpreterFile =
			arg.executable instanceof tg.Symlink
				? await arg.executable.resolve()
				: arg.executable;
		if (!interpreterFile || interpreterFile instanceof tg.Directory) {
			throw new Error("Could not resolve the symlink to the interpreter.");
		}
		tg.File.assert(interpreterFile);
		const interpreterMetadata =
			await std.file.executableMetadata(interpreterFile);
		if (interpreterMetadata.format !== "elf") {
			return tg.unreachable(
				"Cannot build an ld-musl interpreter for a non-ELF executable.",
			);
		}

		const preloads = arg.preloads
			? await Promise.all(
					arg.preloads?.map(async (arg) =>
						manifestTemplateFromArg(await tg.template(arg)),
					),
				)
			: [];

		// If no preload is defined, add the default injection preload.
		if (preloads.length === 0) {
			const arch = interpreterMetadata.arch;
			const host = `${arch}-linux-musl`;
			const buildToolchain = bootstrap.sdk.env(host);
			const injectionLibrary = await injection.default({
				buildToolchain,
				host,
			});

			const injectionManifestSymlink =
				await manifestTemplateFromArg(injectionLibrary);
			preloads.push(injectionManifestSymlink);
		}

		const args = arg.args
			? await Promise.all(arg.args.map(manifestTemplateFromArg))
			: undefined;
		return {
			kind: "ld-musl",
			path,
			libraryPaths,
			preloads,
			args,
		};
	} else if ("kind" in arg && arg.kind === "dyld") {
		// Handle a dyld interpreter.
		const libraryPaths = arg.libraryPaths
			? await Promise.all(
					arg.libraryPaths.map(async (arg) =>
						manifestTemplateFromArg(await tg.template(arg)),
					),
				)
			: undefined;
		const preloads = arg.preloads
			? await Promise.all(
					arg.preloads?.map(async (arg) =>
						manifestTemplateFromArg(await tg.template(arg)),
					),
				)
			: [];

		// If no preload is defined, add the default injection preload.
		if (preloads.length === 0) {
			const host = await std.triple.host();
			const buildToolchain = buildToolchainArg
				? buildToolchainArg
				: bootstrap.sdk.env(host);
			const injectionLibrary = await injection.default({
				buildToolchain,
				host,
			});
			preloads.push(await manifestTemplateFromArg(injectionLibrary));
		}
		return {
			kind: "dyld",
			libraryPaths,
			preloads,
		};
	} else {
		// Handle a normal interpreter.
		const path = await manifestTemplateFromArg(arg.executable);
		const args = await Promise.all(
			arg.args?.map(manifestTemplateFromArg) ?? [],
		);
		return {
			kind: "normal",
			path,
			args,
		};
	}
};

const isManifestInterpreter = (
	arg: unknown,
): arg is wrap.Manifest.Interpreter => {
	return (
		arg !== undefined &&
		arg !== null &&
		typeof arg === "object" &&
		"kind" in arg &&
		(arg.kind === "normal" ||
			arg.kind === "ld-linux" ||
			arg.kind === "ld-musl" ||
			arg.kind === "dyld") &&
		"path" in arg
	);
};

const manifestInterpreterFromExecutableArg = async (
	arg: string | tg.Template | tg.File | tg.Symlink,
	buildToolchainArg?: std.env.Arg,
): Promise<wrap.Manifest.Interpreter | undefined> => {
	// If the arg is a string or template, there is no interpreter.
	if (typeof arg === "string" || arg instanceof tg.Template) {
		return undefined;
	}

	// Resolve the arg to a file if it is a symlink.
	if (arg instanceof tg.Symlink) {
		const resolvedArg = await arg.resolve();
		tg.assert(resolvedArg instanceof tg.File);
		arg = resolvedArg;
	}

	// Get the file's executable metadata.
	const metadata = await std.file.executableMetadata(arg);

	// Handle the executable by its format.
	switch (metadata.format) {
		case "elf": {
			return manifestInterpreterFromElf(metadata, buildToolchainArg);
		}
		case "mach-o": {
			const arch = std.triple.arch(await std.triple.host());
			const host = std.triple.create({ os: "darwin", arch });
			const buildToolchain = bootstrap.sdk.env(host);
			const injectionDylib = await injection.default({
				buildToolchain,
				host,
			});
			return {
				kind: "dyld",
				libraryPaths: undefined,
				preloads: [await manifestTemplateFromArg(injectionDylib)],
			};
		}
		case "shebang": {
			if (metadata.interpreter === undefined) {
				return manifestInterpreterFromArg(
					await defaultShellInterpreter(buildToolchainArg),
					buildToolchainArg,
				);
			} else {
				return undefined;
			}
		}
	}
};

const manifestInterpreterFromElf = async (
	metadata: std.file.ElfExecutableMetadata,
	buildToolchainArg?: std.env.Arg,
): Promise<wrap.Manifest.Interpreter | undefined> => {
	// If there is no interpreter, this is a statically-linked executable. Nothing to do.
	if (metadata.interpreter === undefined) {
		return undefined;
	}

	const libc = metadata.interpreter?.includes("ld-linux") ? "gnu" : "musl";

	let host = std.triple.create({
		os: "linux",
		vendor: "unknown",
		arch: metadata.arch,
		environment: libc,
	});
	// If the interpreter is ld-linux, use the host toolchain. Otherwise, use the bootstrap toolchain.
	const buildToolchain = buildToolchainArg
		? buildToolchainArg
		: libc === "musl"
			? bootstrap.sdk.env(host)
			: gnu.toolchain({ host });

	// Obtain injection library.
	const injectionLib = await injection.default({ buildToolchain, host });

	// Handle each interpreter type.
	if (metadata.interpreter?.includes("ld-linux")) {
		// Handle an ld-linux interpreter.
		const toolchainDir = buildToolchainArg
			? buildToolchainArg
			: await gnu.toolchain({ host });
		const { ldso, libDir } = await std.sdk.toolchainComponents({
			env: toolchainDir,
		});
		tg.assert(
			ldso,
			"Could not find a valid ldso, required for Linux wrappers.",
		);
		return {
			kind: "ld-linux",
			path: await manifestTemplateFromArg(ldso),
			libraryPaths: [await manifestTemplateFromArg(libDir)],
			preloads: [await manifestTemplateFromArg(injectionLib)],
			args: undefined,
		};
	} else if (metadata.interpreter?.includes("ld-musl")) {
		// Handle an ld-musl interpreter.
		host = std.triple.create(host, { environment: "musl" });
		const muslArtifact = await bootstrap.musl.build({ host });
		const libDir = tg.Directory.expect(await muslArtifact.get("lib"));
		const ldso = tg.File.expect(await libDir.get("libc.so"));
		return {
			kind: "ld-musl",
			path: await manifestTemplateFromArg(ldso),
			libraryPaths: [await manifestTemplateFromArg(libDir)],
			preloads: [await manifestTemplateFromArg(injectionLib)],
			args: undefined,
		};
	} else {
		throw new Error(`Unsupported interpreter: "${metadata.interpreter}".`);
	}
};

export const defaultShellInterpreter = async (
	buildToolchainArg?: std.env.Arg,
) => {
	// Provide bash for the detected host system.
	let buildArg: undefined | { sdk: boolean; env: tg.Unresolved<std.env.Arg> } =
		undefined;
	if (buildToolchainArg) {
		buildArg = { sdk: false, env: buildToolchainArg };
	} else {
		buildArg = { sdk: false, env: std.sdk() };
	}
	const shellArtifact = await std.utils.bash.build(buildArg);
	const shellExecutable = tg.File.expect(await shellArtifact.get("bin/bash"));

	//  Add the standard utils.
	// FIXME - make this toggleable alongside the -e -u and pipefail change.
	const env = await std.utils.env(buildArg);

	const bash = wrap({
		buildToolchain: buildToolchainArg,
		executable: shellExecutable,
		identity: "wrapper",
		env,
	});
	return bash;
};

const valueIsTemplateLike = (
	value: tg.Value,
): value is string | tg.Template | tg.Artifact => {
	return (
		typeof value === "string" ||
		tg.Artifact.is(value) ||
		value instanceof tg.Template
	);
};

const manifestMutationFromMutation = async (
	mutation: tg.Mutation,
): Promise<wrap.Manifest.Mutation> => {
	if (mutation.inner.kind === "unset") {
		return { kind: "unset" };
	} else if (mutation.inner.kind === "set") {
		const value = mutation.inner.value;
		return {
			kind: "set",
			value: await manifestValueFromValue(value),
		};
	} else if (mutation.inner.kind === "set_if_unset") {
		const value = mutation.inner.value;
		tg.assert(
			valueIsTemplateLike(value),
			`Expected a template arg, but got ${JSON.stringify(value)}.`,
		);
		return {
			kind: "set_if_unset",
			value: manifestValueFromManifestTemplate(
				await manifestTemplateFromArg(value),
			),
		};
	} else if (mutation.inner.kind === "prefix") {
		const template = mutation.inner.template;
		tg.assert(
			valueIsTemplateLike(template),
			`Expected a template arg, but got ${JSON.stringify(template)}.`,
		);
		return {
			kind: "prefix",
			template: await manifestTemplateFromArg(template),
			separator: mutation.inner.separator ?? ":",
		};
	} else if (mutation.inner.kind === "suffix") {
		const template = mutation.inner.template;
		tg.assert(
			valueIsTemplateLike(template),
			`Expected a template arg, but got ${JSON.stringify(template)}.`,
		);
		return {
			kind: "suffix",
			template: await manifestTemplateFromArg(template),
			separator: mutation.inner.separator ?? ":",
		};
	} else if (mutation.inner.kind === "prepend") {
		tg.assert(mutation.inner.values.every(valueIsTemplateLike));
		const values = await Promise.all(
			mutation.inner.values.map(async (arg) =>
				manifestValueFromManifestTemplate(await manifestTemplateFromArg(arg)),
			),
		);
		return { kind: "prepend", values };
	} else if (mutation.inner.kind === "append") {
		tg.assert(mutation.inner.values.every(valueIsTemplateLike));
		const values = await Promise.all(
			mutation.inner.values.map(async (arg) =>
				manifestValueFromManifestTemplate(await manifestTemplateFromArg(arg)),
			),
		);
		return { kind: "append", values };
	} else {
		return tg.unreachable();
	}
};

const manifestValueFromManifestTemplate = (
	template: wrap.Manifest.Template,
): wrap.Manifest.Value => {
	return {
		kind: "template",
		value: template,
	};
};

export const fileOrSymlinkFromManifestTemplate = async (
	manifestTemplate: wrap.Manifest.Template,
): Promise<tg.File | tg.Symlink> => {
	let template = await templateFromManifestTemplate(manifestTemplate);
	if (template.components.length !== 1) {
		throw new Error(
			`expected a template with exactly one component, got ${manifestTemplate}`,
		);
	}
	const component = template.components[0];
	if (!(component instanceof tg.File || component instanceof tg.Symlink)) {
		const received =
			component instanceof tg.Directory ? await component.id() : component;
		throw new Error(`expected a file or symlink, got ${received}`);
	}
	return component;
};

const templateFromManifestTemplate = (
	manifestTemplate: wrap.Manifest.Template,
): Promise<tg.Template> =>
	manifestTemplate.components.reduce((result, component) => {
		switch (component.kind) {
			case "artifact": {
				return tg`${result}${tg.Artifact.withId(component.value)}`;
			}
			case "string": {
				return tg`${result}${component.value}`;
			}
			default: {
				return tg.unreachable();
			}
		}
	}, tg``);

const mutationFromManifestMutation = (
	manifestMutation: wrap.Manifest.Mutation,
): Promise<tg.Mutation<tg.Template.Arg>> => {
	if (manifestMutation.kind === "unset") {
		return Promise.resolve(tg.Mutation.unset());
	} else if (manifestMutation.kind === "set") {
		return tg.Mutation.set(valueFromManifestValue(manifestMutation.value));
	} else if (manifestMutation.kind === "set_if_unset") {
		return tg.Mutation.setIfUnset(
			valueFromManifestValue(manifestMutation.value),
		);
	} else if (manifestMutation.kind === "prepend") {
		return tg.Mutation.append(
			manifestMutation.values.map(valueFromManifestValue),
		);
	} else if (manifestMutation.kind === "append") {
		return tg.Mutation.append(
			manifestMutation.values.map(valueFromManifestValue),
		);
	} else if (manifestMutation.kind === "prefix") {
		return tg.Mutation.prefix(
			templateFromManifestTemplate(manifestMutation.template),
			manifestMutation.separator,
		);
	} else if (manifestMutation.kind === "suffix") {
		return tg.Mutation.suffix(
			templateFromManifestTemplate(manifestMutation.template),
			manifestMutation.separator,
		);
	} else {
		return tg.unreachable();
	}
};

const manifestValueFromValue = async (
	value: tg.Value,
): Promise<wrap.Manifest.Value> => {
	if (typeof value === undefined) {
		return undefined;
	} else if (typeof value === "boolean") {
		return value;
	} else if (typeof value === "number") {
		return value;
	} else if (typeof value === "string") {
		return value;
	} else if (value instanceof tg.Directory) {
		return { kind: "directory", value: await value.id() };
	} else if (value instanceof tg.File) {
		return { kind: "file", value: await value.id() };
	} else if (value instanceof tg.Symlink) {
		return { kind: "symlink", value: await value.id() };
	} else if (value instanceof tg.Template) {
		return { kind: "template", value: await manifestTemplateFromArg(value) };
	} else if (value instanceof tg.Mutation) {
		return {
			kind: "mutation",
			value: await manifestMutationFromMutation(value),
		};
	} else if (value instanceof Array) {
		return await Promise.all(value.map(manifestValueFromValue));
	} else if (typeof value === "object") {
		const obj: { [key: string]: wrap.Manifest.Value } = {};
		const entries = Object.entries(value);
		const promises = entries.map(async ([key, val]) => {
			return { key, value: await manifestValueFromValue(val) };
		});
		const resolvedEntries = await Promise.all(promises);
		for (const entry of resolvedEntries) {
			obj[entry.key] = entry.value;
		}
		return { kind: "map", value: obj };
	} else {
		return tg.unreachable();
	}
};

const valueFromManifestValue = async (
	value: wrap.Manifest.Value,
): Promise<tg.Value> => {
	if (value instanceof Array) {
		return await Promise.all(value.map(valueFromManifestValue));
	} else if (value === undefined) {
		return undefined;
	} else if (typeof value === "boolean") {
		return value;
	} else if (typeof value === "number") {
		return value;
	} else if (typeof value === "string") {
		return value;
	} else if (value.kind === "directory") {
		return tg.Directory.withId(value.value);
	} else if (value.kind === "file") {
		return tg.File.withId(value.value);
	} else if (value.kind === "symlink") {
		return tg.Symlink.withId(value.value);
	} else if (value.kind === "template") {
		return await templateFromManifestTemplate(value.value);
	} else if (value.kind === "mutation") {
		return mutationFromManifestMutation(value.value);
	} else if (value.kind === "map") {
		const ret: tg.Value = {};
		const entries = Object.entries(value.value);
		const promises = entries.map(async ([key, val]) => {
			return { key, value: await valueFromManifestValue(val) };
		});
		const resolvedEntries = await Promise.all(promises);
		for (const entry of resolvedEntries) {
			ret[entry.key] = entry.value;
		}
		return ret;
	} else {
		return tg.unreachable();
	}
};

/** Yield the key/value pairs this manifest sets once all mutations are applied. */
export async function* manifestEnvVars(
	manifest: wrap.Manifest,
): AsyncGenerator<[string, tg.Template | undefined]> {
	yield* std.env.envVars(await wrap.envArgFromManifestEnv(manifest.env));
}

const manifestTemplateFromArg = async (
	arg: tg.Template.Arg | wrap.Manifest.Template,
): Promise<wrap.Manifest.Template> => {
	if (isManifestTemplate(arg)) {
		return arg as wrap.Manifest.Template;
	}
	const t = await tg.template(arg);
	const components: Array<wrap.Manifest.Template.Component> = await Promise.all(
		t.components.map(async (component) => {
			if (typeof component === "string") {
				return { kind: "string", value: component };
			} else {
				return { kind: "artifact", value: await component.id() };
			}
		}),
	);
	return {
		components: components ?? [],
	};
};

// FIXME - this can likely go straight to std.env.EnvObject, not ArgObject.
const envArgFromMapValue = async (
	value: wrap.Manifest.Value,
): Promise<std.env.ArgObject> => {
	tg.assert(
		!(value instanceof Array) &&
			typeof value === "object" &&
			value.kind === "map",
		"Malformed env, expected a map of mutations.",
	);
	const ret: std.env.ArgObject = {};
	for (const [key, val] of Object.entries(value.value)) {
		if (val instanceof Array) {
			ret[key] = await Promise.all(
				val.map(async (inner) => {
					const val = await valueFromManifestValue(inner);
					tg.assert(
						val instanceof tg.Mutation,
						"Malformed env, expected a mutation.",
					);
					return val;
				}),
			);
		} else if (typeof val === "object" && val.kind === "mutation") {
			ret[key] = [await mutationFromManifestMutation(val.value)];
		} else {
			throw new Error(
				"Malformed env, expected a mutation or array of mutations.",
			);
		}
	}
	return ret;
};

const isManifestTemplate = (
	arg: tg.Template.Arg | wrap.Manifest.Template,
): arg is wrap.Manifest.Template => {
	return (
		typeof arg === "object" &&
		arg !== null &&
		"components" in arg &&
		typeof arg.components === "object" &&
		arg.components instanceof Array &&
		arg.components.every(isManifestTemplateComponent)
	);
};

const isManifestTemplateComponent = (
	arg: unknown,
): arg is wrap.Manifest.Template.Component => {
	return (
		typeof arg === "object" &&
		arg !== null &&
		"kind" in arg &&
		(arg.kind === "string" || arg.kind === "artifact")
	);
};

/** Yield the objects referenced by a manifest. */
export async function* manifestDependencies(
	manifest: wrap.Manifest,
): AsyncGenerator<tg.Object> {
	// Get the references from the interpreter.
	switch (manifest.interpreter?.kind) {
		case undefined: {
			break;
		}
		case "normal":
			yield* manifestTemplateDependencies(manifest.interpreter.path);
			for (const arg of manifest.interpreter.args ?? []) {
				yield* manifestTemplateDependencies(arg);
			}
			break;
		case "ld-linux": {
			yield* manifestTemplateDependencies(manifest.interpreter.path);
			if (manifest.interpreter.libraryPaths) {
				for (const libraryPath of manifest.interpreter.libraryPaths) {
					yield* manifestTemplateDependencies(libraryPath);
				}
			}
			if (manifest.interpreter.preloads) {
				for (const preload of manifest.interpreter.preloads) {
					yield* manifestTemplateDependencies(preload);
				}
			}
			break;
		}
		case "ld-musl": {
			yield* manifestTemplateDependencies(manifest.interpreter.path);
			if (manifest.interpreter.libraryPaths) {
				for (const libraryPath of manifest.interpreter.libraryPaths) {
					yield* manifestTemplateDependencies(libraryPath);
				}
			}
			if (manifest.interpreter.preloads) {
				for (const preload of manifest.interpreter.preloads) {
					yield* manifestTemplateDependencies(preload);
				}
			}
			break;
		}
		case "dyld": {
			if (manifest.interpreter.libraryPaths) {
				for (const libraryPath of manifest.interpreter.libraryPaths) {
					yield* manifestTemplateDependencies(libraryPath);
				}
			}
			if (manifest.interpreter.preloads) {
				for (const preload of manifest.interpreter.preloads) {
					yield* manifestTemplateDependencies(preload);
				}
			}
			break;
		}
	}

	// Get the references from the executable.
	yield* manifestExecutableDependencies(manifest.executable);

	// Get the references from the env.
	if (manifest.env) {
		yield* manifestMutationDependencies(manifest.env);
	}

	// Get the references from the args.
	if (manifest.args && manifest.args instanceof Array) {
		for (const arg of manifest.args) {
			if (isManifestTemplate(arg)) {
				yield* manifestTemplateDependencies(arg);
			}
		}
	}
}

/** Yield the artifacts prent in the manifest env. */
async function* manifestMutationDependencies(
	mutation: wrap.Manifest.Mutation,
): AsyncGenerator<tg.Object> {
	switch (mutation.kind) {
		case "unset":
			break;
		case "set":
		case "set_if_unset":
			yield* manifestValueDependencies(mutation.value);
			break;
		case "prefix":
		case "suffix":
			yield* manifestTemplateDependencies(mutation.template);
			break;
		case "prepend":
		case "append":
			for (const value of mutation.values) {
				yield* manifestValueDependencies(value);
			}
			break;
	}
}

/** Yield the artifacts references by an executable. */
async function* manifestExecutableDependencies(
	executable: wrap.Manifest.Executable,
): AsyncGenerator<tg.Object> {
	yield* manifestTemplateDependencies(executable.value);
}

/** Yield the artifacts referenced by a template. */
async function* manifestTemplateDependencies(
	template: wrap.Manifest.Template,
): AsyncGenerator<tg.Object> {
	for (const component of template.components) {
		if (component.kind === "artifact") {
			yield tg.Artifact.withId(component.value);
		}
	}
}

/** Yield the artifacts referenced by a value. */
async function* manifestValueDependencies(
	value: wrap.Manifest.Value,
): AsyncGenerator<tg.Object> {
	if (value instanceof Array) {
		for (const v of value) {
			yield* manifestValueDependencies(v);
		}
	} else if (typeof value === "object" && value.kind === "directory") {
		yield tg.Artifact.withId(value.value);
	} else if (typeof value === "object" && value.kind === "file") {
		yield tg.Artifact.withId(value.value);
	} else if (typeof value === "object" && value.kind === "symlink") {
		yield tg.Artifact.withId(value.value);
	} else if (typeof value === "object" && value.kind === "template") {
		yield* manifestTemplateDependencies(value.value);
	} else if (typeof value === "object" && value.kind === "mutation") {
		yield* manifestMutationDependencies(value.value);
	} else if (typeof value === "object" && value.kind === "map") {
		for (const v of Object.values(value.value)) {
			yield* manifestValueDependencies(v);
		}
	}
}

export const artifactId = (artifact: tg.Artifact): Promise<tg.Artifact.Id> => {
	if (artifact instanceof tg.Directory) {
		return artifact.id();
	} else if (artifact instanceof tg.File) {
		return artifact.id();
	} else if (artifact instanceof tg.Symlink) {
		return artifact.id();
	} else {
		return tg.unreachable();
	}
};

export const pushOrSet = (
	obj: { [key: string]: unknown },
	key: string,
	value: tg.Value,
) => {
	if (obj === undefined) {
		obj = {};
		obj[key] = value;
	} else if (obj[key] === undefined) {
		obj[key] = value;
	} else {
		if (!Array.isArray(obj[key])) {
			obj[key] = [obj[key]];
		}
		tg.assert(obj && key in obj && Array.isArray(obj[key]));
		const a = obj[key] as Array<tg.Value>;
		a.push(value);
		obj[key] = a;
	}
};

/** Basic program for testing the wrapper code. */
export const argAndEnvDump = tg.target(async () => {
	const sdkEnv = await std.env.arg(bootstrap.sdk(), {
		TANGRAM_LINKER_TRACING: "tangram=trace",
	});

	return tg.File.expect(
		await (
			await tg.target(tg`cc -xc ${inspectProcessSource} -o $OUTPUT`, {
				env: sdkEnv,
			})
		).output(),
	);
});

export const test = tg.target(async () => {
	await Promise.all([
		testSingleArgObjectNoMutations(),
		testDependencies(),
		testDylibPath(),
		testContentExecutable(),
		testContentExecutableVariadic(),
	]);
	return true;
});

export const testSingleArgObjectNoMutations = tg.target(async () => {
	const executable = await argAndEnvDump();
	const executableID = await executable.id();
	// The program is a wrapper produced by the LD proxy.
	console.log("argAndEnvDump wrapper ID", executableID);

	// Get the value of the original executable.
	const origManifest = await wrap.Manifest.read(executable);
	tg.assert(origManifest);
	const origManifestExecutable = origManifest.executable;
	tg.assert(origManifestExecutable.kind === "path");
	const origExecutable = await wrap
		.executableFromManifestExecutable(origManifestExecutable)
		.then(tg.File.expect);
	const origExecutableId = await origExecutable.id();
	console.log("origExecutable", origExecutableId);

	const buildToolchain = await bootstrap.sdk.env();

	const wrapper = await wrap(executable, {
		args: ["--arg1", "--arg2"],
		buildToolchain,
		env: {
			HELLO: "WORLD",
		},
	});
	const wrapperID = await wrapper.id();
	console.log("wrapper id", wrapperID);

	// Check the manifest can be deserialized properly.
	const manifest = await wrap.Manifest.read(wrapper);
	console.log("wrapper manifest", manifest);
	tg.assert(manifest);
	tg.assert(manifest.identity === "executable");
	tg.assert(manifest.interpreter);

	// Check the output matches the expected output.
	const output = await tg
		.target(tg`${wrapper} > $OUTPUT`)
		.then((target) => target.output())
		.then(tg.File.expect);
	const text = await output.text();
	console.log("text", text);

	const os = await std.triple.host().then(std.triple.os);

	if (os === "linux") {
		tg.assert(
			text.includes(`/proc/self/exe: /.tangram/artifacts/${origExecutableId}`),
			"Expected /proc/self/exe to be set to the artifact ID of the wrapped executable",
		);
		tg.assert(
			text.includes(`argv[0]: /.tangram/artifacts/${wrapperID}`),
			"Expected argv[0] to be set to the wrapper that was invoked",
		);
	} else if (os === "darwin") {
		tg.assert(
			text.match(
				new RegExp(
					`_NSGetExecutablePath: .*\\.tangram/artifacts/${origExecutableId}`,
				),
			),
			"Expected _NSGetExecutablePath to point to the wrapped executable",
		);
		tg.assert(
			text.match(
				new RegExp(`argv\\[0\\]: .*\\.tangram/artifacts/${wrapperID}`),
			),
			"Expected argv[0] to point to the wrapper that was invoked",
		);
	}

	tg.assert(
		text.includes("argv[1]: --arg1"),
		"Expected first arg to be --arg1",
	);
	tg.assert(
		text.includes("argv[2]: --arg2"),
		"Expected second arg to be --arg2",
	);
	tg.assert(text.includes("HELLO=WORLD"), "Expected HELLO to be set");

	return wrapper;
});

export const testContentExecutable = tg.target(async () => {
	const buildToolchain = bootstrap.sdk();
	const wrapper = await std.wrap({
		buildToolchain,
		executable: `echo $NAME`,
		env: {
			NAME: "Tangram",
		},
	});

	console.log("wrapper", await wrapper.id());
	// Check the output matches the expected output.
	const output = await tg
		.target(tg`set -x; ${wrapper} > $OUTPUT`, {
			env: { TANGRAM_WRAPPER_TRACING: "tangram=trace" },
		})
		.then((target) => target.output())
		.then(tg.File.expect);
	const text = await output.text().then((t) => t.trim());
	console.log("text", text);
	tg.assert(text.includes("Tangram"));

	return true;
});

export const testContentExecutableVariadic = tg.target(async () => {
	const buildToolchain = bootstrap.sdk();
	const wrapper = await std.wrap(
		`echo "$NAME"`,
		{ env: { NAME: "Tangram" } },
		{
			buildToolchain,
		},
	);
	console.log("wrapper", await wrapper.id());
	// Check the output matches the expected output.
	const output = await tg
		.target(tg`set -x; ${wrapper} > $OUTPUT`, {
			env: { TANGRAM_WRAPPER_TRACING: "tangram=trace" },
		})
		.then((target) => target.output())
		.then(tg.File.expect);
	const text = await output.text().then((t) => t.trim());
	console.log("text", text);
	tg.assert(text.includes("Tangram"));

	return true;
});

export const testDependencies = tg.target(async () => {
	const buildToolchain = await bootstrap.sdk.env();
	const transitiveDependency = await tg.file("I'm a transitive reference");
	const transitiveDependencyId = await transitiveDependency.id();
	console.log("transitiveReference", transitiveDependencyId);
	const binDir = await tg.directory({
		bin: {
			foo: tg.file("hi", {
				executable: true,
				dependencies: {
					transitiveDependencyId: { item: transitiveDependency },
				},
			}),
		},
	});
	console.log("binDir", await binDir.id());

	const bootstrapShell = await bootstrap.shell();
	const shellExe = await bootstrapShell.get("bin/sh").then(tg.File.expect);

	const wrapper = await std.wrap({
		buildToolchain,
		executable: shellExe,
		env: {
			PATH: tg`${binDir}/bin`,
		},
	});
	console.log("wrapper", await wrapper.id());
	const wrapperDependencies = await wrapper.dependencies();
	console.log("wrapperDependencies", wrapperDependencies);

	// return wrapper;

	const bundle = tg.Artifact.bundle(wrapper);
	return bundle;
});

import libGreetSource from "./wrap/test/greet.c" with { type: "file" };
import driverSource from "./wrap/test/driver.c" with { type: "file" };
export const testDylibPath = tg.target(async () => {
	const host = await std.triple.host();
	const os = std.triple.os(host);
	const dylibExt = os === "darwin" ? "dylib" : "so";

	// Obtain a non-proxied toolchain env from the bootstrap
	const bootstrapSdk = bootstrap.sdk.env();

	// Compile the greet library
	const sharedLibraryDir = await (
		await tg.target(
			tg`mkdir -p $OUTPUT/lib && cc -shared -fPIC -xc -o $OUTPUT/lib/libgreet.${dylibExt} ${libGreetSource}`,
			{ env: await std.env.arg(bootstrapSdk) },
		)
	)
		.output()
		.then(tg.Directory.expect);
	console.log("sharedLibraryDir", await sharedLibraryDir.id());

	// Compile the driver.
	const driver = await (
		await tg.target(tg`cc -xc -o $OUTPUT ${driverSource} -ldl`, {
			env: await std.env.arg(bootstrapSdk),
		})
	)
		.output()
		.then(tg.File.expect);
	console.log("unwrapped driver", await driver.id());

	// Wrap the driver with just the interpreter.
	const interpreterWrapper = await wrap(driver, {
		buildToolchain: bootstrapSdk,
		env: { FOO: "bar" },
	});
	console.log("interpreterWrapper", await interpreterWrapper.id());

	// Re-wrap the driver program with the library path.
	const libraryPathWrapper = await wrap(interpreterWrapper, {
		buildToolchain: bootstrapSdk,
		libraryPaths: [tg.symlink(tg`${sharedLibraryDir}/lib`)],
	});
	console.log("libraryPathWrapper", await libraryPathWrapper.id());
	return libraryPathWrapper;
});
