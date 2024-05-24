import * as bootstrap from "./bootstrap.tg.ts";
import * as gcc from "./sdk/gcc.tg.ts";
import { interpreterName } from "./sdk/libc.tg.ts";
import * as std from "./tangram.tg.ts";
import * as injection from "./wrap/injection.tg.ts";
import * as workspace from "./wrap/workspace.tg.ts";
import inspectProcessSource from "./wrap/inspectProcess.c" with {
	type: "file",
};

/** This module provides the `std.wrap()` function, which can be used to bundle an executable with a predefined environment and arguments, either of which may point to other Tangram artifacts.*/

/** Wrap an executable. */
export async function wrap(
	...args: std.args.UnresolvedArgs<wrap.Arg>
): Promise<tg.File> {
	return await wrap.target(...args);
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
		interpreter?: tg.File | tg.Symlink | Interpreter;

		/** Library paths to include. If the executable is wrapped, they will be merged. */
		libraryPaths?: Array<tg.Directory | tg.Symlink>;

		/** Specify how to handle executables that are already Tangram wrappers. When `merge` is true, retain the original executable in the resulting manifest. When `merge` is set to false, produce a manifest pointing to the original wrapper. Default: true. */
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

	/** Process variadiac arguments. */
	export let arg = async (...args: std.args.UnresolvedArgs<wrap.Arg>) => {
		let objectArgs = await Promise.all(
			std.flatten(await Promise.all(args.map(tg.resolve))).map(async (arg) => {
				if (arg === undefined) {
					return {};
				} else if (arg instanceof tg.File || arg instanceof tg.Symlink) {
					return { executable: arg };
				} else if (typeof arg === "string" || arg instanceof tg.Template) {
					// This is a "content" executable.
					let defaultShell = await defaultShellInterpreter();
					return {
						identity: "executable" as const,
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
		let mutationArgs = await std.args.createMutations<
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
			env: env_,
			executable,
			host,
			identity,
			interpreter,
			merge,
			libraryPaths,
		} = await std.args.applyMutations(mutationArgs);

		// If the executable is a file and the behavior is merge, try to read the manifest from it.
		if (merge) {
			if (!(executable instanceof tg.File)) {
				throw new Error(
					`Cannot merge a non-file executable.  Received ${executable}.`,
				);
			}

			// Try to read the manifest from it.
			let existingManifest = await wrap.Manifest.read(executable);
			if (existingManifest !== undefined) {
				let env_ = await wrap.envArgFromManifestEnv(existingManifest.env);
				let env =
					env_ instanceof tg.Mutation ? env_ : await tg.Mutation.append(env_);
				identity = existingManifest.identity;
				interpreter = await wrap.interpreterFromManifestInterpreter(
					existingManifest.interpreter,
				);
				executable = await wrap.executableFromManifestExecutable(
					existingManifest.executable,
				);
				env = env;
				args_ = await Promise.all(
					(existingManifest.args ?? []).map(templateFromManifestTemplate),
				);
			}
		}

		let env = await std.env.arg(env_ ?? []);

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

	export let target = tg.target(async (...args: std.Args<wrap.Arg>) => {
		let arg = await wrap.arg(...args);

		tg.assert(arg.executable !== undefined, "No executable was provided.");

		let executable = await manifestExecutableFromArg(arg.executable);

		let identity = arg.identity ?? "executable";

		let host = arg.host ?? (await std.triple.host());
		std.triple.assert(host);
		let buildToolchain = arg.buildToolchain
			? arg.buildToolchain
			: std.triple.os(host) === "linux"
			  ? await gcc.toolchain({ host })
			  : await bootstrap.sdk.env(host);

		let manifestInterpreter = arg.interpreter
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
			let file =
				executable instanceof tg.Symlink
					? await executable.resolve()
					: executable;
			if (!file || file instanceof tg.Directory) {
				return tg.unreachable(
					"Following the executable symlink either failed or returned a directory.",
				);
			}
			let metadata = await std.file.executableMetadata(file);
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
					await Promise.all(arg.libraryPaths.map(manifestSymlinkFromArg)),
				);
			}
			manifestInterpreter.libraryPaths = paths;
		}

		let manifestEnv = await wrap.manifestEnvFromEnvObject(
			arg.env as std.env.EnvObject,
		);
		let manifestArgs = await Promise.all(
			(arg.args ?? []).map(manifestTemplateFromArg),
		);

		let manifest: wrap.Manifest = {
			identity,
			interpreter: manifestInterpreter,
			executable,
			env: manifestEnv,
			args: manifestArgs,
		};

		// Get the wrapper executable.
		let wrapper = await workspace.wrapper({
			buildToolchain,
			host,
		});

		// Write the manifest to the wrapper and return.
		let output = await wrap.Manifest.write(wrapper, manifest);
		return output;
	});

	export let envArgFromManifestEnv = async (
		mutation: wrap.Manifest.Mutation | undefined,
	): Promise<std.env.ArgObject> => {
		let ret: std.env.EnvObject = {};
		if (mutation?.kind !== "set") {
			return ret;
		}
		tg.assert(mutation.kind === "set", "Malformed env, expected set or unset.");
		return envArgFromMapValue(mutation.value);
	};

	export let interpreterFromManifestInterpreter = async (
		manifestInterpreter: wrap.Manifest.Interpreter | undefined,
	): Promise<wrap.Interpreter | undefined> => {
		switch (manifestInterpreter?.kind) {
			case "normal": {
				return {
					executable: await symlinkFromManifestSymlink(
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
					executable: await symlinkFromManifestSymlink(
						manifestInterpreter.path,
					),
					libraryPaths:
						manifestInterpreter.libraryPaths === undefined
							? undefined
							: await Promise.all(
									manifestInterpreter.libraryPaths.map(
										symlinkFromManifestSymlink,
									),
							  ),
					preloads:
						manifestInterpreter.preloads === undefined
							? undefined
							: await Promise.all(
									manifestInterpreter.preloads.map(symlinkFromManifestSymlink),
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
					executable: await symlinkFromManifestSymlink(
						manifestInterpreter.path,
					),
					libraryPaths:
						manifestInterpreter.libraryPaths === undefined
							? undefined
							: await Promise.all(
									manifestInterpreter.libraryPaths.map(
										symlinkFromManifestSymlink,
									),
							  ),
					preloads:
						manifestInterpreter.preloads === undefined
							? undefined
							: await Promise.all(
									manifestInterpreter.preloads.map(symlinkFromManifestSymlink),
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
										symlinkFromManifestSymlink,
									),
							  ),
					preloads:
						manifestInterpreter.preloads === undefined
							? undefined
							: await Promise.all(
									manifestInterpreter.preloads.map(symlinkFromManifestSymlink),
							  ),
				};
			}
			default: {
				return tg.unreachable(`Unexpected interpreter ${manifestInterpreter}`);
			}
		}
	};

	export let executableFromManifestExecutable = async (
		manifestExecutable: wrap.Manifest.Executable,
	): Promise<tg.Template | tg.Symlink> => {
		if (manifestExecutable.kind === "content") {
			return templateFromManifestTemplate(manifestExecutable.value);
		} else {
			return symlinkFromManifestSymlink(manifestExecutable.value);
		}
	};

	export let manifestEnvFromEnvObject = async (
		envObject: std.env.EnvObject,
	): Promise<wrap.Manifest.Mutation | undefined> => {
		let value = await std.env.arg(envObject).then(manifestValueFromValue);
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
	export let tryUnwrap = async (
		file: tg.File,
	): Promise<tg.File | tg.Template | undefined> => {
		try {
			return await unwrap(file);
		} catch (_) {
			return undefined;
		}
	};

	/** Unwrap a wrapped executable. Throws an error if the input was not a Tangram executable. */
	export let unwrap = async (file: tg.File): Promise<tg.File | tg.Template> => {
		let manifest = await wrap.Manifest.read(file);
		if (!manifest) {
			throw new Error(
				`Cannot unwrap ${await file.id()}: not a Tangram wrapper.`,
			);
		}
		if (manifest.executable.kind === "content") {
			return templateFromManifestTemplate(manifest.executable.value);
		} else {
			let symlink = await symlinkFromManifestSymlink(manifest.executable.value);
			let resolved = await symlink.resolve();
			if (resolved instanceof tg.File) {
				return resolved;
			} else {
				throw new Error(
					`Could not resolve executable symlink ${await symlink.id()} to a file.`,
				);
			}
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
			path: Manifest.Symlink;
			args?: Array<Manifest.Template> | undefined;
		};

		export type LdLinuxInterpreter = {
			kind: "ld-linux";
			path: Manifest.Symlink;
			libraryPaths?: Array<Manifest.Symlink> | undefined;
			preloads?: Array<Manifest.Symlink> | undefined;
			args?: Array<Manifest.Template> | undefined;
		};

		export type LdMuslInterpreter = {
			kind: "ld-musl";
			path: Manifest.Symlink;
			libraryPaths?: Array<Manifest.Symlink> | undefined;
			preloads?: Array<Manifest.Symlink> | undefined;
			args?: Array<Manifest.Template> | undefined;
		};

		export type DyLdInterpreter = {
			kind: "dyld";
			libraryPaths?: Array<Manifest.Symlink> | undefined;
			preloads?: Array<Manifest.Symlink> | undefined;
		};

		export type Executable =
			| { kind: "path"; value: Manifest.Symlink }
			| { kind: "content"; value: Manifest.Template };

		export type Symlink = {
			artifact?: tg.Artifact.Id | undefined;
			path?: string | undefined;
		};

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
			| { kind: "path"; value: tg.Path }
			| { kind: "template"; value: Manifest.Template }
			| { kind: "mutation"; value: Manifest.Mutation }
			| { kind: "map"; value: { [key: string]: Manifest.Value } }
			| Array<Manifest.Value>;

		// The non-serializeable type of a normalized env.
		export type Env = tg.Mutation<std.env.EnvObject>;

		/** Read a manifest from the end of a file. */
		export let read = async (
			file: tg.File,
		): Promise<wrap.Manifest | undefined> => {
			// Read the file.
			let fileBytes = await file.bytes();
			let filePosition = fileBytes.length;

			// Read and verify the magic number.
			filePosition -= MANIFEST_MAGIC_NUMBER.length;
			let magicNumberBytes = fileBytes.slice(-MANIFEST_MAGIC_NUMBER.length);
			for (let i = 0; i < MANIFEST_MAGIC_NUMBER.length; i++) {
				if (magicNumberBytes[i] !== MANIFEST_MAGIC_NUMBER[i]) {
					return undefined;
				}
			}

			// Read and verify the version.
			filePosition -= MANIFEST_MAGIC_NUMBER.length;
			let version = Number(
				new DataView(fileBytes.buffer).getBigUint64(filePosition, true),
			);
			if (version !== MANIFEST_VERSION) {
				return undefined;
			}

			// Read the manifest length.
			filePosition -= 8;
			let manifestLength = Number(
				new DataView(fileBytes.buffer).getBigUint64(filePosition, true),
			);

			// Read the manifest.
			filePosition -= manifestLength;
			let manifestBytes = fileBytes.slice(
				filePosition,
				filePosition + manifestLength,
			);

			// Deserialize the manifest.
			let manifest = tg.encoding.json.decode(
				tg.encoding.utf8.decode(manifestBytes),
			) as wrap.Manifest;

			return manifest;
		};

		/** Write a manifest to a file. */
		export let write = async (file: tg.File, manifest: wrap.Manifest) => {
			// Serialize the manifest.
			let manifestBytes = tg.encoding.utf8.encode(
				tg.encoding.json.encode(manifest),
			);

			// Retrieve the file's blob.
			let fileBlob = file.contents();

			// Create a buffer for the manifest plus three 64-bit values (manifest length, version, magic number).
			let newBytesLength = manifestBytes.length + 8 + 8 + 8;
			let newBytesPosition = 0;
			let littleEndian = true;
			let newBytes = new Uint8Array(newBytesLength);

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
			let contents = tg.blob(fileBlob, newBytes);

			// Collect the manifest references.
			let references_ = new Set<tg.Artifact.Id>();
			for await (let reference of manifestReferences(manifest)) {
				references_.add(await reference.id());
			}
			let fileReferences = await file.references();
			await Promise.all(
				fileReferences.map(async (reference) => {
					references_.add(await reference.id());
				}),
			);
			let references = Array.from(references_).map((id) =>
				tg.Artifact.withId(id),
			);

			// Create the file.
			let newFile = tg.file({
				contents,
				executable: true,
				references,
			});

			return newFile;
		};
	}
}

let isArgObject = (arg: unknown): arg is wrap.ArgObject => {
	return (
		typeof arg === "object" &&
		!(
			arg instanceof tg.File ||
			arg instanceof tg.Symlink ||
			arg instanceof tg.Template
		)
	);
};

const MANIFEST_MAGIC_NUMBER: Uint8Array = new Uint8Array([
	116, 97, 110, 103, 114, 97, 109, 0,
]);

const MANIFEST_VERSION = 0;

let manifestExecutableFromArg = async (
	arg: string | tg.Template | tg.File | tg.Symlink | wrap.Manifest.Executable,
): Promise<wrap.Manifest.Executable> => {
	if (isManifestExecutable(arg)) {
		return arg;
	} else if (arg instanceof tg.File || arg instanceof tg.Symlink) {
		let value = await manifestSymlinkFromArg(arg);
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

let isManifestExecutable = (arg: unknown): arg is wrap.Manifest.Executable => {
	return (
		arg !== undefined &&
		arg !== null &&
		typeof arg === "object" &&
		"kind" in arg &&
		(arg.kind === "path" || arg.kind === "content")
	);
};

let manifestInterpreterFromArg = async (
	arg: tg.File | tg.Symlink | wrap.Interpreter | wrap.Manifest.Interpreter,
	buildToolchainArg?: std.env.Arg,
): Promise<wrap.Manifest.Interpreter> => {
	if (isManifestInterpreter(arg)) {
		return arg;
	}

	// If the arg is an executable, then wrap it and create a normal interpreter.
	if (arg instanceof tg.File || arg instanceof tg.Symlink) {
		let interpreter = await std.wrap({
			buildToolchain: buildToolchainArg,
			executable: arg,
		});
		let path = await manifestSymlinkFromArg(interpreter);
		return {
			kind: "normal",
			path,
			args: [],
		};
	}

	// Otherwise, create the interpreter specified by the arg object.
	if ("kind" in arg && arg.kind === "ld-linux") {
		// Handle an ld-linux interpreter.
		let path = await manifestSymlinkFromArg(arg.executable);
		let libraryPaths = arg.libraryPaths
			? await Promise.all(
					arg.libraryPaths.map(async (arg) =>
						manifestSymlinkFromArg(await tg.template(arg)),
					),
			  )
			: undefined;

		// Build an injection dylib to match the interpreter.
		let interpreterFile =
			arg.executable instanceof tg.Symlink
				? await arg.executable.resolve()
				: arg.executable;
		if (!interpreterFile || interpreterFile instanceof tg.Directory) {
			throw new Error("Could not resolve the symlink to the interpreter.");
		}
		let interpreterMetadata =
			await std.file.executableMetadata(interpreterFile);
		if (interpreterMetadata.format !== "elf") {
			return tg.unreachable(
				"Cannot build an ld-linux interpreter for a non-ELF executable.",
			);
		}
		let arch = interpreterMetadata.arch;
		let host = `${arch}-unknown-linux-gnu`;
		let buildToolchain = buildToolchainArg
			? buildToolchainArg
			: gcc.toolchain({ host });
		let injectionLibrary = await injection.default({
			buildToolchain,
			host,
		});

		// Combine the injection with any additional preloads specified by the caller.
		let preloads = [await manifestSymlinkFromArg(injectionLibrary)];
		let additionalPreloads = arg.preloads
			? await Promise.all(
					arg.preloads?.map(async (arg) =>
						manifestSymlinkFromArg(await tg.template(arg)),
					),
			  )
			: [];
		preloads = preloads.concat(additionalPreloads);
		let args = arg.args
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
		let path = await manifestSymlinkFromArg(arg.executable);
		let libraryPaths = arg.libraryPaths
			? await Promise.all(
					arg.libraryPaths.map(async (arg) =>
						manifestSymlinkFromArg(await tg.template(arg)),
					),
			  )
			: undefined;

		// Build an injection dylib to match the interpreter.
		let interpreterFile =
			arg.executable instanceof tg.Symlink
				? await arg.executable.resolve()
				: arg.executable;
		if (!interpreterFile || interpreterFile instanceof tg.Directory) {
			throw new Error("Could not resolve the symlink to the interpreter.");
		}
		let interpreterMetadata =
			await std.file.executableMetadata(interpreterFile);
		if (interpreterMetadata.format !== "elf") {
			return tg.unreachable(
				"Cannot build an ld-musl interpreter for a non-ELF executable.",
			);
		}
		let arch = interpreterMetadata.arch;
		let host = `${arch}-linux-musl`;
		let buildToolchain = buildToolchainArg
			? buildToolchainArg
			: gcc.toolchain({ host });
		let injectionLibrary = await injection.default({
			buildToolchain,
			host,
		});

		// Combine the injection with any additional preloads specified by the caller.
		let preloads = [await manifestSymlinkFromArg(injectionLibrary)];
		let additionalPreloads = arg.preloads
			? await Promise.all(
					arg.preloads?.map(async (arg) =>
						manifestSymlinkFromArg(await tg.template(arg)),
					),
			  )
			: [];
		preloads = preloads.concat(additionalPreloads);

		let args = arg.args
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
		let libraryPaths = arg.libraryPaths
			? await Promise.all(
					arg.libraryPaths.map(async (arg) =>
						manifestSymlinkFromArg(await tg.template(arg)),
					),
			  )
			: undefined;
		// Select the universal machO injecton dylib.  Either arch will produce the same result, so just pick one.
		let host = await std.triple.host();
		let buildToolchain = buildToolchainArg
			? buildToolchainArg
			: bootstrap.sdk.env(host);
		let injectionLibrary = await injection.default({
			buildToolchain,
			host,
		});
		let preloads = [await manifestSymlinkFromArg(injectionLibrary)];
		let additionalPreloads = arg.preloads
			? await Promise.all(
					arg.preloads?.map(async (arg) =>
						manifestSymlinkFromArg(await tg.template(arg)),
					),
			  )
			: [];
		preloads = preloads.concat(additionalPreloads);
		return {
			kind: "dyld",
			libraryPaths,
			preloads,
		};
	} else {
		// Handle a normal interpreter.
		let path = await manifestSymlinkFromArg(arg.executable);
		let args = await Promise.all(arg.args?.map(manifestTemplateFromArg) ?? []);
		return {
			kind: "normal",
			path,
			args,
		};
	}
};

let isManifestInterpreter = (
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

let manifestInterpreterFromExecutableArg = async (
	arg: string | tg.Template | tg.File | tg.Symlink,
	buildToolchainArg?: std.env.Arg,
): Promise<wrap.Manifest.Interpreter | undefined> => {
	// If the arg is a string or template, there is no interpreter.
	if (typeof arg === "string" || arg instanceof tg.Template) {
		return undefined;
	}

	// Resolve the arg to a file if it is a symlink.
	if (arg instanceof tg.Symlink) {
		let resolvedArg = await arg.resolve();
		tg.assert(resolvedArg instanceof tg.File);
		arg = resolvedArg;
	}

	// Get the file's executable metadata.
	let metadata = await std.file.executableMetadata(arg);

	// Handle the executable by its format.
	switch (metadata.format) {
		case "elf": {
			return manifestInterpreterFromElf(metadata, buildToolchainArg);
		}
		case "mach-o": {
			let arch = std.triple.arch(await std.triple.host());
			let host = std.triple.create({ os: "darwin", arch });
			let buildToolchain = buildToolchainArg
				? buildToolchainArg
				: bootstrap.sdk.env(host);
			return {
				kind: "dyld",
				libraryPaths: undefined,
				preloads: [
					await manifestSymlinkFromArg(
						await injection.default({
							buildToolchain,
							host,
						}),
					),
				],
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

let manifestInterpreterFromElf = async (
	metadata: std.file.ElfExecutableMetadata,
	buildToolchainArg?: std.env.Arg,
): Promise<wrap.Manifest.Interpreter | undefined> => {
	// If there is no interpreter, this is a statically-linked executable. Nothing to do.
	if (metadata.interpreter === undefined) {
		return undefined;
	}

	let libc = metadata.interpreter?.includes("ld-linux") ? "gnu" : "musl";

	let host = std.triple.create({
		os: "linux",
		vendor: "unknown",
		arch: metadata.arch,
		environment: libc,
	});
	// If the interpreter is ld-linux, use the host toolchain. Otherwise, use the bootstrap toolchain.
	let buildToolchain = buildToolchainArg
		? buildToolchainArg
		: libc === "musl"
		  ? bootstrap.sdk.env(host)
		  : gcc.toolchain({ host });

	// Obtain injection library.
	let injectionLib = await injection.default({ buildToolchain, host });

	// Handle each interpreter type.
	if (metadata.interpreter?.includes("ld-linux")) {
		// Handle an ld-linux interpreter.
		let toolchainDir = buildToolchainArg
			? buildToolchainArg
			: await gcc.toolchain({ host });
		let { ldso, libDir } = await std.sdk.toolchainComponents({
			env: toolchainDir,
		});
		tg.assert(
			ldso,
			"Could not find a valid ldso, required for Linux wrappers.",
		);
		return {
			kind: "ld-linux",
			path: await manifestSymlinkFromArg(ldso),
			libraryPaths: [await manifestSymlinkFromArg(libDir)],
			preloads: [await manifestSymlinkFromArg(injectionLib)],
			args: undefined,
		};
	} else if (metadata.interpreter?.includes("ld-musl")) {
		// Handle an ld-musl interpreter.
		host = std.triple.create(host, { environment: "musl" });
		let muslArtifact = await bootstrap.musl.build({ host });
		let libDir = tg.Directory.expect(await muslArtifact.get("lib"));
		let ldso = tg.File.expect(await libDir.get(interpreterName(host)));
		return {
			kind: "ld-musl",
			path: await manifestSymlinkFromArg(ldso),
			libraryPaths: [await manifestSymlinkFromArg(libDir)],
			preloads: [await manifestSymlinkFromArg(injectionLib)],
			args: undefined,
		};
	} else {
		throw new Error(`Unsupported interpreter: "${metadata.interpreter}".`);
	}
};

export let defaultShellInterpreter = async (
	buildToolchainArg?: std.env.Arg,
) => {
	// Provide bash for the detected host system.
	let buildArg = undefined;
	if (buildToolchainArg) {
		buildArg = { env: buildToolchainArg };
	}
	let shellArtifact = await std.utils.bash.build(buildArg);
	let shellExecutable = tg.File.expect(await shellArtifact.get("bin/bash"));

	//  Add the standard utils.
	let env = await std.utils.env(buildArg);

	let bash = wrap({
		buildToolchain: buildToolchainArg,
		executable: shellExecutable,
		identity: "wrapper",
		args: ["-euo", "pipefail"],
		env,
	});
	return bash;
};

let symlinkFromManifestSymlink = async (
	symlink: wrap.Manifest.Symlink,
): Promise<tg.Symlink> => {
	if (symlink.artifact) {
		let artifact = tg.Artifact.withId(symlink.artifact);
		if (symlink.path) {
			return tg.symlink({ artifact, path: tg.Path.new(symlink.path) });
		}
		return tg.symlink({ artifact });
	} else if (symlink.path) {
		return tg.symlink({ path: tg.Path.new(symlink.path) });
	} else {
		return tg.symlink();
	}
};

let manifestSymlinkFromArg = async (
	arg: string | tg.Template | tg.Artifact | wrap.Manifest.Template,
): Promise<wrap.Manifest.Symlink> => {
	if (isManifestTemplate(arg)) {
		let t = await templateFromManifestTemplate(arg);
		return manifestSymlinkFromArg(t);
	} else if (typeof arg === "string" || arg instanceof tg.Template) {
		return manifestSymlinkFromArg(await tg.symlink(arg));
	} else if (arg instanceof tg.Symlink) {
		let path = await arg.path();
		return {
			artifact: await (await arg.artifact())?.id(),
			path: path ? path.toString() : undefined,
		};
	} else if (tg.Artifact.is(arg)) {
		return { artifact: await arg.id() };
	} else {
		return tg.unreachable();
	}
};

let valueIsTemplateLike = (
	value: tg.Value,
): value is string | tg.Template | tg.Artifact => {
	return (
		typeof value === "string" ||
		tg.Artifact.is(value) ||
		value instanceof tg.Template
	);
};

let manifestMutationFromMutation = async (
	mutation: tg.Mutation,
): Promise<wrap.Manifest.Mutation> => {
	if (mutation.inner.kind === "unset") {
		return { kind: "unset" };
	} else if (mutation.inner.kind === "set") {
		let value = mutation.inner.value;
		return {
			kind: "set",
			value: await manifestValueFromValue(value),
		};
	} else if (mutation.inner.kind === "set_if_unset") {
		let value = mutation.inner.value;
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
		let template = mutation.inner.template;
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
		let template = mutation.inner.template;
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
		let values = await Promise.all(
			mutation.inner.values.map(async (arg) =>
				manifestValueFromManifestTemplate(await manifestTemplateFromArg(arg)),
			),
		);
		return { kind: "prepend", values };
	} else if (mutation.inner.kind === "append") {
		tg.assert(mutation.inner.values.every(valueIsTemplateLike));
		let values = await Promise.all(
			mutation.inner.values.map(async (arg) =>
				manifestValueFromManifestTemplate(await manifestTemplateFromArg(arg)),
			),
		);
		return { kind: "append", values };
	} else {
		return tg.unreachable();
	}
};

let manifestValueFromManifestTemplate = (
	template: wrap.Manifest.Template,
): wrap.Manifest.Value => {
	return {
		kind: "template",
		value: template,
	};
};

let templateFromManifestTemplate = (
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

let mutationFromManifestMutation = (
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

let manifestValueFromValue = async (
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
	} else if (value instanceof tg.Path) {
		return { kind: "path", value };
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
		let obj: { [key: string]: wrap.Manifest.Value } = {};
		let entries = Object.entries(value);
		let promises = entries.map(async ([key, val]) => {
			return { key, value: await manifestValueFromValue(val) };
		});
		let resolvedEntries = await Promise.all(promises);
		for (let entry of resolvedEntries) {
			obj[entry.key] = entry.value;
		}
		return { kind: "map", value: obj };
	} else {
		return tg.unreachable();
	}
};

let valueFromManifestValue = async (
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
	} else if (value.kind === "path") {
		return value.value;
	} else if (value.kind === "template") {
		return await templateFromManifestTemplate(value.value);
	} else if (value.kind === "mutation") {
		return mutationFromManifestMutation(value.value);
	} else if (value.kind === "map") {
		let ret: tg.Value = {};
		let entries = Object.entries(value.value);
		let promises = entries.map(async ([key, val]) => {
			return { key, value: await valueFromManifestValue(val) };
		});
		let resolvedEntries = await Promise.all(promises);
		for (let entry of resolvedEntries) {
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

let manifestTemplateFromArg = async (
	arg: tg.Template.Arg | wrap.Manifest.Template,
): Promise<wrap.Manifest.Template> => {
	if (isManifestTemplate(arg)) {
		return arg as wrap.Manifest.Template;
	}
	let t = await tg.template(arg);
	let components: Array<wrap.Manifest.Template.Component> = await Promise.all(
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
let envArgFromMapValue = async (
	value: wrap.Manifest.Value,
): Promise<std.env.ArgObject> => {
	tg.assert(
		!(value instanceof Array) &&
			typeof value === "object" &&
			value.kind === "map",
		"Malformed env, expected a map of mutations.",
	);
	let ret: std.env.ArgObject = {};
	for (let [key, val] of Object.entries(value.value)) {
		if (val instanceof Array) {
			ret[key] = await Promise.all(
				val.map(async (inner) => {
					let val = await valueFromManifestValue(inner);
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

let isManifestTemplate = (
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

let isManifestTemplateComponent = (
	arg: unknown,
): arg is wrap.Manifest.Template.Component => {
	return (
		typeof arg === "object" &&
		arg !== null &&
		"kind" in arg &&
		(arg.kind === "string" || arg.kind === "artifact")
	);
};

/** Yield the artifacts referenced by a manifest. */
export async function* manifestReferences(
	manifest: wrap.Manifest,
): AsyncGenerator<tg.Artifact> {
	// Get the references from the interpreter.
	switch (manifest.interpreter?.kind) {
		case undefined: {
			break;
		}
		case "normal":
			yield* manifestSymlinkReferences(manifest.interpreter.path);
			for (let arg of manifest.interpreter.args ?? []) {
				yield* manifestTemplateReferences(arg);
			}
			break;
		case "ld-linux": {
			yield* manifestSymlinkReferences(manifest.interpreter.path);
			if (manifest.interpreter.libraryPaths) {
				for (let libraryPath of manifest.interpreter.libraryPaths) {
					yield* manifestSymlinkReferences(libraryPath);
				}
			}
			if (manifest.interpreter.preloads) {
				for (let preload of manifest.interpreter.preloads) {
					yield* manifestSymlinkReferences(preload);
				}
			}
			break;
		}
		case "ld-musl": {
			yield* manifestSymlinkReferences(manifest.interpreter.path);
			if (manifest.interpreter.libraryPaths) {
				for (let libraryPath of manifest.interpreter.libraryPaths) {
					yield* manifestSymlinkReferences(libraryPath);
				}
			}
			if (manifest.interpreter.preloads) {
				for (let preload of manifest.interpreter.preloads) {
					yield* manifestSymlinkReferences(preload);
				}
			}
			break;
		}
		case "dyld": {
			if (manifest.interpreter.libraryPaths) {
				for (let libraryPath of manifest.interpreter.libraryPaths) {
					yield* manifestSymlinkReferences(libraryPath);
				}
			}
			if (manifest.interpreter.preloads) {
				for (let preload of manifest.interpreter.preloads) {
					yield* manifestSymlinkReferences(preload);
				}
			}
			break;
		}
	}

	// Get the references from the executable.
	yield* manifestExecutableReferences(manifest.executable);

	// Get the references from the env.
	if (manifest.env) {
		yield* manifestMutationReferences(manifest.env);
	}

	// Get the references from the args.
	if (manifest.args && manifest.args instanceof Array) {
		for (let arg of manifest.args) {
			if (isManifestTemplate(arg)) {
				yield* manifestTemplateReferences(arg);
			}
		}
	}
}

/** Yield the artifacts prent in the manifest env. */
async function* manifestMutationReferences(
	mutation: wrap.Manifest.Mutation,
): AsyncGenerator<tg.Artifact> {
	switch (mutation.kind) {
		case "unset":
			break;
		case "set":
		case "set_if_unset":
			yield* manifestValueReferences(mutation.value);
			break;
		case "prefix":
		case "suffix":
			yield* manifestTemplateReferences(mutation.template);
			break;
		case "prepend":
		case "append":
			for (let value of mutation.values) {
				yield* manifestValueReferences(value);
			}
			break;
	}
}

/** Yield the artifacts references by an executable. */
async function* manifestExecutableReferences(
	executable: wrap.Manifest.Executable,
): AsyncGenerator<tg.Artifact> {
	if (executable.kind === "path") {
		yield* manifestSymlinkReferences(executable.value);
	} else if (executable.kind === "content") {
		yield* manifestTemplateReferences(executable.value);
	} else {
		return tg.unreachable();
	}
}

/** Yield the artifact referenced by a symlink. */
async function* manifestSymlinkReferences(
	symlink: wrap.Manifest.Symlink,
): AsyncGenerator<tg.Artifact> {
	yield* symlinkReferences(await symlinkFromManifestSymlink(symlink));
}

/** Yield the artifacts referenced by a template. */
async function* manifestTemplateReferences(
	template: wrap.Manifest.Template,
): AsyncGenerator<tg.Artifact> {
	for (let component of template.components) {
		if (component.kind === "artifact") {
			yield* artifactReferences(tg.Artifact.withId(component.value));
		}
	}
}

/** Yield the artifacts referenced by an artifact. */
async function* artifactReferences(
	artifact: tg.Artifact,
): AsyncGenerator<tg.Artifact> {
	if (artifact instanceof tg.File) {
		yield* fileReferences(artifact);
	} else if (artifact instanceof tg.Directory) {
		yield* directoryReferences(artifact);
	} else if (artifact instanceof tg.Symlink) {
		yield* symlinkReferences(artifact);
	} else {
		return tg.unreachable();
	}
}

/** Yield the artifacts referenced by a directory. */
async function* directoryReferences(
	directory: tg.Directory,
): AsyncGenerator<tg.Artifact> {
	yield directory;
	for await (let [_, artifact] of directory) {
		yield* artifactReferences(artifact);
	}
}

/** Yield any references found from in a file */
async function* fileReferences(file: tg.File): AsyncGenerator<tg.Artifact> {
	yield file;
	for (let reference of await file.references()) {
		yield reference;
	}
}

/** Yield any references found from resolving a symlink. */
async function* symlinkReferences(
	symlink: tg.Symlink,
): AsyncGenerator<tg.Artifact> {
	yield symlink;
	let artifact = await symlink.artifact();
	if (artifact) {
		yield artifact;
	}
}

/** Yield the artifacts referenced by a value. */
async function* manifestValueReferences(
	value: wrap.Manifest.Value,
): AsyncGenerator<tg.Artifact> {
	if (value instanceof Array) {
		for (let v of value) {
			yield* manifestValueReferences(v);
		}
	} else if (typeof value === "object" && value.kind === "directory") {
		yield tg.Artifact.withId(value.value);
	} else if (typeof value === "object" && value.kind === "file") {
		yield tg.Artifact.withId(value.value);
	} else if (typeof value === "object" && value.kind === "symlink") {
		yield tg.Artifact.withId(value.value);
	} else if (typeof value === "object" && value.kind === "template") {
		yield* manifestTemplateReferences(value.value);
	} else if (typeof value === "object" && value.kind === "mutation") {
		yield* manifestMutationReferences(value.value);
	} else if (typeof value === "object" && value.kind === "map") {
		for (let v of Object.values(value.value)) {
			yield* manifestValueReferences(v);
		}
	}
}

export let artifactId = (artifact: tg.Artifact): Promise<tg.Artifact.Id> => {
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

export let pushOrSet = (
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
		let a = obj[key] as Array<tg.Value>;
		a.push(value);
		obj[key] = a;
	}
};

/** Basic program for testing the wrapper code. */
export let argAndEnvDump = tg.target(async () => {
	let toolchain = await bootstrap.toolchain();
	let utils = await bootstrap.utils();

	return tg.File.expect(
		await tg.build(tg`cc -xc ${inspectProcessSource} -o $OUTPUT`, {
			env: { PATH: tg`${toolchain}/bin:${utils}/bin` },
		}),
	);
});

export let testSingleArgObjectNoMutations = tg.target(async () => {
	let executable = await argAndEnvDump();
	let executableID = await executable.id();

	let buildToolchain = await bootstrap.sdk.env();

	let wrapper = await wrap({
		args: ["--arg1", "--arg2"],
		buildToolchain,
		env: {
			HELLO: "WORLD",
		},
		executable,
	});
	let wrapperID = await wrapper.id();

	// Check the manifest can be deserialized properly.
	let manifest = await wrap.Manifest.read(wrapper);
	tg.assert(manifest);
	tg.assert(manifest.identity === "executable");
	tg.assert(manifest.interpreter);
	tg.assert(manifest.interpreter.kind === "ld-musl");
	tg.assert(manifest.interpreter.preloads?.length === 1);

	// Check the output matches the expected output.
	let output = tg.File.expect(await tg.build(tg`${wrapper} > $OUTPUT`));
	let text = await output.text();
	tg.assert(
		text.includes(`/proc/self/exe: /.tangram/artifacts/${executableID}`),
		"Expected /proc/self/exe to be set to the artifact ID of the wrapped executable",
	);
	tg.assert(
		text.includes(`argv[0]: /.tangram/artifacts/${wrapperID}`),
		"Expected argv[0] to be set to the wrapper that was invoked",
	);
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
