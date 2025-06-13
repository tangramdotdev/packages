import * as bootstrap from "./bootstrap.tg.ts";
import * as gnu from "./sdk/gnu.tg.ts";
import * as std from "./tangram.ts";
import * as injection from "./wrap/injection.tg.ts";
import * as workspace from "./wrap/workspace.tg.ts";
import inspectProcessSource from "./wrap/test/inspectProcess.c" with {
	type: "file",
};

export { ccProxy, ldProxy, wrapper } from "./wrap/workspace.tg.ts";

/** This module provides the `std.wrap()` function, which can be used to bundle an executable with a predefined environment and arguments, either of which may point to other Tangram artifacts.*/

/** Wrap an executable. */
export async function wrap(...args: std.Args<wrap.Arg>): Promise<tg.File> {
	const arg = await wrap.arg(...args);

	tg.assert(arg.executable !== undefined, "No executable was provided.");
	tg.assert(
		arg.identity !== undefined,
		"Could not determine requested identity",
	);

	const executable = await manifestExecutableFromArg(arg.executable);

	const detectedBuild = await std.triple.host();
	const host = arg.host ?? (await std.triple.host());
	std.triple.assert(host);
	const buildToolchain = arg.buildToolchain
		? arg.buildToolchain
		: std.triple.os(host) === "linux"
			? await std.env.arg(
					await tg.build(gnu.toolchain, { host: detectedBuild, target: host }),
					{ utils: false },
				)
			: await bootstrap.sdk.env(host);

	// Construct the interpreter.
	const manifestInterpreter = await manifestInterpreterFromWrapArgObject({
		buildToolchain,
		interpreter: arg.interpreter,
		executable: arg.executable,
		libraryPaths: arg.libraryPaths,
		libraryPathStrategy: arg.libraryPathStrategy,
	});

	// Ensure we're not building an identity=executable wrapper for an unwrapped statically-linked executable.
	if (
		arg.identity === "executable" &&
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

	const manifestEnv = await wrap.manifestEnvFromEnvObject(
		arg.env as std.env.EnvObject,
	);
	const manifestArgs = await Promise.all(
		(arg.args ?? []).map(manifestTemplateFromArg),
	);

	const manifest: wrap.Manifest = {
		identity: arg.identity,
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
		buildToolchain?: std.env.EnvObject | undefined;

		/** Environment variables to bind to the wrapper. If the executable is wrapped, they will be merged. */
		env?: std.env.Arg;

		/** The executable to wrap. */
		executable?: string | tg.Template | tg.File | tg.Symlink;

		/** The host system to produce a wrapper for. */
		host?: string;

		/** The identity of the executable. The default is "executable". */
		identity?: Identity;

		/** The interpreter to run the executable with. If not provided, a default is detected. */
		interpreter?: tg.File | tg.Symlink | tg.Template | Interpreter | undefined;

		/** Library paths to include. If the executable is wrapped, they will be merged. */
		libraryPaths?: Array<tg.Directory | tg.Symlink | tg.Template>;

		/** Which library path strategy should we use? The default is "unfilteredIsolate", which separates libraries into individual directories. */
		libraryPathStrategy?: LibraryPathStrategy | undefined;

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
		kind: "normal";

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

	/** Wrappers for dynamically linked executables can employ one of these strategies to optimize the set of library paths.
	 * This strategy is only used to produce the manifest, and is not retained as a property once complete.
	 * These mirror the strategies available in the Tangram `ld` proxy.
	 *
	 * - "none": Do not manipulate library paths. The paths provided by the user will be retained as-is. This is the strategy used for all wrappers for non-dynamically-linked executables (static binaries, scripts).
	 * - "unfilteredIsolate": Search each library path for library files, and separate them into individual directories. This option does not check whether libraries are marked as needed first, all found files are retained.
	 * - "filter": Paths that do not contain libraries marked as needed by the executable are dropped.
	 * - "resolve": After filtering, all library paths are resolved to their innermost directory. If you provided `${someArtifact}/lib`, it will be transformed to `${someArtifactLib}`, with no trailing subpath. This prevents, for example, the `"include" directory from being retained as a dependency of your wrapper.`
	 * - "isolate": Each needed library will be placed in its own unique directory. This is the default strategy, which maximizes cache hits between wrappers.
	 * - "combine": Each needed library will be placed together in a single directory. This is the most space-efficient, but likely to cause cache misses and duplication. If one wrapper needs `libc.so` and another needs `libc.so` and `libm.so`, you'll wind up with two copies of `libc.so` in your dependencies. If not checking out or bundling your artifact, this is not a concern, but external checkouts will incur the extra cost. To share a single copy of the common dependency, consider the "isolate" strategy.
	 */
	export type LibraryPathStrategy =
		| "none"
		| "unfilteredIsolate"
		| "filter"
		| "resolve"
		| "isolate"
		| "combine";

	export type Manifest = {
		identity: Identity;
		interpreter?: Manifest.Interpreter | undefined;
		executable: Manifest.Executable;
		env?: Manifest.Mutation | undefined;
		args?: Array<Manifest.Template> | undefined;
	};

	/** Process variadic arguments. */
	export const arg = async (
		...args: std.Args<wrap.Arg>
	): Promise<wrap.ArgObject> => {
		let {
			args: args_ = [],
			buildToolchain,
			env: env_ = {},
			executable,
			host: host_,
			identity,
			interpreter,
			merge: merge_ = true,
			libraryPaths = [],
			libraryPathStrategy,
		} = await std.args.apply<wrap.Arg, wrap.ArgObject>({
			args,
			map: async (arg) => {
				if (arg === undefined) {
					return {};
				} else if (arg instanceof tg.File || arg instanceof tg.Symlink) {
					return { executable: arg };
				} else if (typeof arg === "string" || arg instanceof tg.Template) {
					// This is a "content" executable.
					return {
						identity: "wrapper" as const,
						interpreter: await wrap.defaultShell(),
						executable: arg,
					};
				} else if (isArgObject(arg)) {
					return { ...arg, env: arg.env };
				} else {
					return tg.unreachable(`Unsupported argument: ${arg}`);
				}
			},
			reduce: {
				env: (a, b) => std.env.arg(a, b, { utils: false }),
				libraryPaths: "append",
				args: "append",
			},
		});

		tg.assert(executable !== undefined);

		const host = host_ ?? (await std.triple.host());

		// If the executable arg is a wrapper, obtain its manifest.
		const existingManifest =
			await wrap.existingManifestFromExecutableArg(executable);

		// Determine whether to try to merge this wrapper with an existing one. If the user specified `true`, only honor if an existing manifest was found.
		const merge = merge_ && existingManifest !== undefined;

		const envs: tg.Unresolved<Array<std.env.Arg>> = [];

		// If the executable is a file and the behavior is merge, try to read the manifest from it.
		if (merge) {
			if (existingManifest === undefined) {
				const dbg = tg.Artifact.is(executable) ? executable.id : executable;
				throw new Error(
					`Could not locate existing manifest to merge with.  Received ${dbg}.`,
				);
			}

			envs.push(await wrap.envObjectFromManifestEnv(existingManifest.env));
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

		const env = await std.env.arg(...envs, env_, { utils: false });

		// If the executable is a content executable, make sure there is a normal interpreter for it and sensible identity.
		if (executable instanceof tg.Template || typeof executable === "string") {
			if (interpreter === undefined) {
				interpreter = await wrap.defaultShell({ buildToolchain });
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
		// If identity is still undefined, default to executable.
		if (identity === undefined) {
			identity = "executable";
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
			libraryPathStrategy,
		};
	};

	export type DefaultShellArg = {
		/** The toolchain to use to build constituent components. Default: `std.sdk()`. */
		buildToolchain?: std.env.EnvObject | undefined;
		/** Should scripts treat unset variables as errors? Equivalent to setting `-u`. Default: true. */
		disallowUnset?: boolean;
		/** Should scripts exit on errors? Equivalent to setting `-e`. Default: true. */
		exitOnErr?: boolean;
		/** Which identity should we use for the shell? Default: "wrapper". */
		identity?: "interpreter" | "wrapper";
		/** Whether to incldue the complete `std.utils()` environment. Default: true. */
		includeUtils?: boolean;
		/** Should failures inside pipelines cause the whole pipeline to fail? Equivalent to setting `-o pipefail`. Default: true. */
		pipefail?: boolean;
	};

	/** Helper to configure a `bash` executable to use as the interpreter for content executables. */
	export const defaultShell = async (arg?: DefaultShellArg) => {
		const {
			buildToolchain: buildToolchain_,
			disallowUnset = true,
			exitOnErr = true,
			identity = "wrapper",
			includeUtils = true,
			pipefail = true,
		} = arg ?? {};

		// Provide bash for the detected host system.
		let buildArg:
			| undefined
			| { bootstrap: boolean; env: tg.Unresolved<std.env.EnvObject> } =
			undefined;
		if (buildToolchain_) {
			buildArg = { bootstrap: true, env: buildToolchain_ };
		} else {
			buildArg = { bootstrap: true, env: std.sdk() };
		}
		const shellExecutable = await std.utils.bash
			.build(buildArg)
			.then((artifact) => artifact.get("bin/bash"))
			.then(tg.File.expect);

		const wrapArgs: Array<wrap.Arg> = [
			{
				executable: shellExecutable,
				identity,
			},
		];
		if (buildToolchain_ !== undefined) {
			wrapArgs.push({ buildToolchain: buildToolchain_ });
		}

		// Set up args.
		const args: Array<string> = [];
		if (disallowUnset) {
			args.push("-u");
		}
		if (exitOnErr) {
			args.push("-e");
		}
		if (pipefail) {
			args.push("-o");
			args.push("pipefail");
		}
		if (args.length > 0) {
			wrapArgs.push({ args });
		}

		// Add utils.
		if (includeUtils) {
			wrapArgs.push({ env: await std.utils.env(buildArg) });
		}

		// Produce wrapped shell.
		return wrap(...wrapArgs);
	};

	export const envObjectFromManifestEnv = async (
		mutation: wrap.Manifest.Mutation | undefined,
	): Promise<std.env.EnvObject> => {
		const ret: std.env.EnvObject = {};
		if (mutation?.kind !== "set") {
			return ret;
		}
		tg.assert(mutation.kind === "set", "Malformed env, expected set or unset.");
		return envObjectFromMapValue(mutation.value);
	};

	export const interpreterFromManifestInterpreter = async (
		manifestInterpreter: wrap.Manifest.Interpreter | undefined,
	): Promise<wrap.Interpreter | undefined> => {
		if (manifestInterpreter === undefined) {
			return undefined;
		}
		const kind = manifestInterpreter.kind;
		switch (kind) {
			case "normal": {
				return {
					kind,
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
					kind,
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
					kind,
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
					kind,
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
		const value = await manifestValueFromValue(envObject);
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

	/** Attempt to obtain the needed libraries of the wrapped exectuable of a wrapper. */
	export const tryNeededLibraries = async (
		file: tg.File,
	): Promise<Array<string> | undefined> => {
		try {
			return await neededLibraries(file);
		} catch (_) {
			return undefined;
		}
	};

	/** Obtain the needed libraries of the wrapped executable of a wrapper. */
	export const neededLibraries = async (
		file: tg.File,
	): Promise<Array<string>> => {
		const manifest = await wrap.Manifest.read(file);
		if (!manifest) {
			await file.store();
			throw new Error(
				`Cannot determine needed libraries for ${file.id}: not a Tangram wrapper.`,
			);
		}
		tg.assert(
			manifest.interpreter !== undefined,
			`cannot determine needed libraries for a wrapper without an interpreter`,
		);
		tg.assert(
			manifest.interpreter.kind !== "normal",
			`cannot determine needed libraries for a normal interpreter`,
		);
		const wrappedExecutable = manifest.executable;
		tg.assert(
			wrappedExecutable.kind !== "content",
			"cannot determine needed libraries for a content executable",
		);
		const wrappedExecutableFile = await fileOrSymlinkFromManifestTemplate(
			manifest.executable.value,
		);
		tg.assert(
			wrappedExecutableFile instanceof tg.File,
			`executable must be a file, received ${wrappedExecutableFile.id}`,
		);
		return await getNeededLibraries(wrappedExecutableFile);
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
			throw new Error(`Cannot unwrap ${file.id}: not a Tangram wrapper.`);
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
			| { kind: "append"; values: Array<Manifest.Value> }
			| {
					kind: "merge";
					value: { kind: "map"; value: { [key: string]: Manifest.Value } };
			  };

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
			// Read the header.
			const headerLength = MANIFEST_MAGIC_NUMBER.length + 8 + 8;
			const headerBytes = await file.read({
				position: `end.-${headerLength}`,
				length: headerLength,
			});
			if (headerBytes.length !== headerLength) {
				return undefined;
			}
			let position = headerBytes.length;

			// Read and verify the magic number.
			position -= MANIFEST_MAGIC_NUMBER.length;
			const magicNumberBytes = headerBytes.slice(-MANIFEST_MAGIC_NUMBER.length);
			for (let i = 0; i < MANIFEST_MAGIC_NUMBER.length; i++) {
				if (magicNumberBytes[i] !== MANIFEST_MAGIC_NUMBER[i]) {
					return undefined;
				}
			}

			// Read and verify the version.
			position -= 8;
			const version = Number(
				new DataView(headerBytes.buffer).getBigUint64(position, true),
			);
			if (version !== MANIFEST_VERSION) {
				return undefined;
			}

			// Read the manifest length.
			position -= 8;
			const manifestLength = Number(
				new DataView(headerBytes.buffer).getBigUint64(position, true),
			);

			// Read the manifest.
			const manifestBytes = await file.read({
				position: `end.-${headerLength + manifestLength}`,
				length: manifestLength,
			});

			// Deserialize the manifest.
			const manifestString = tg.encoding.utf8.decode(manifestBytes);
			const manifest = tg.encoding.json.decode(manifestString) as wrap.Manifest;

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
				dependencies_.add(dependencies.id);
			}
			const fileDependencies = await file.dependencyObjects();
			await Promise.all(
				fileDependencies.map(async (reference) => {
					await reference.store();
					dependencies_.add(reference.id);
				}),
			);
			const dependencies: { [reference: string]: tg.Referent<tg.Object> } = {};
			for (const dependency of dependencies_) {
				const item = tg.Object.withId(dependency);
				dependencies[dependency] = { item };
			}

			// Create the file.
			const newFile = await tg.file({
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

/** The subset of `wrap.ArgObject` relevant to producing a `wrap.Manifest.Interpreter`. */
type ManifestInterpreterArg = {
	buildToolchain?: std.env.EnvObject | undefined;
	interpreter?:
		| tg.File
		| tg.Symlink
		| tg.Template
		| wrap.Interpreter
		| undefined;
	executable: string | tg.Template | tg.File | tg.Symlink;
	libraryPaths?: Array<tg.Directory | tg.Symlink | tg.Template> | undefined;
	libraryPathStrategy?: wrap.LibraryPathStrategy | undefined;
};

/** Produce the manifest interpreter object given a set of parameters. */
const manifestInterpreterFromWrapArgObject = async (
	arg: ManifestInterpreterArg,
): Promise<wrap.Manifest.Interpreter | undefined> => {
	let interpreter = arg.interpreter
		? await interpreterFromArg(arg.interpreter, arg.buildToolchain)
		: await interpreterFromExecutableArg(arg.executable, arg.buildToolchain);
	if (interpreter === undefined) {
		return undefined;
	}

	// If this is not a "normal" interpreter run the library path optimization, including any additional paths from the user.
	if (interpreter.kind !== "normal") {
		const { executable, libraryPaths, libraryPathStrategy } = arg;
		interpreter = await optimizeLibraryPaths({
			executable,
			interpreter,
			libraryPaths,
			libraryPathStrategy,
		});
	}

	return manifestInterpreterFromWrapInterpreter(interpreter);
};

/** Serialize an interpreter into its manifest form. */
const manifestInterpreterFromWrapInterpreter = async (
	interpreter: wrap.Interpreter,
): Promise<wrap.Manifest.Interpreter> => {
	// Process each field present in the incoming object.
	const { kind } = interpreter;

	// Process all fields concurrently
	const [path, libraryPaths, preloads, args] = await Promise.all([
		// Only process executable if it exists
		"executable" in interpreter
			? manifestTemplateFromArg(interpreter.executable)
			: Promise.resolve(undefined),

		// Only process libraryPaths if it exists
		"libraryPaths" in interpreter && interpreter.libraryPaths !== undefined
			? Promise.all(interpreter.libraryPaths.map(manifestTemplateFromArg))
			: Promise.resolve(undefined),

		// Only process preloads if it exists
		"preloads" in interpreter && interpreter.preloads !== undefined
			? Promise.all(interpreter.preloads.map(manifestTemplateFromArg))
			: Promise.resolve(undefined),

		// Only process args if it exists
		"args" in interpreter && interpreter.args !== undefined
			? Promise.all(interpreter.args.map(manifestTemplateFromArg))
			: Promise.resolve(undefined),
	]);

	// COnstruct a `manifest.Interpreter` using only fields that are not `undefined`.
	switch (kind) {
		case "normal": {
			return {
				kind,
				path: path!,
				...(args && { args }),
			};
		}
		case "ld-linux":
		case "ld-musl": {
			return {
				kind,
				path: path!,
				...(libraryPaths && { libraryPaths }),
				...(preloads && { preloads }),
				...(args && { args }),
			};
		}
		case "dyld": {
			return {
				kind,
				...(libraryPaths && { libraryPaths }),
				...(preloads && { preloads }),
			};
		}
		default: {
			return tg.unreachable(`unrecognized kind ${kind}`);
		}
	}
};

/** Given an interpreter arg, produce an interpreter object with all fields populated. */
const interpreterFromArg = async (
	arg: tg.File | tg.Symlink | tg.Template | wrap.Interpreter,
	buildToolchainArg?: std.env.EnvObject,
): Promise<wrap.Interpreter> => {
	// If the arg is an executable, then wrap it and create a normal interpreter.
	if (
		arg instanceof tg.File ||
		arg instanceof tg.Symlink ||
		arg instanceof tg.Template
	) {
		const executable = await std.wrap({
			buildToolchain: buildToolchainArg,
			executable: arg,
		});
		return {
			kind: "normal",
			executable,
			args: [],
		};
	}

	// We now have a `wrap.Interpreter` object. Fill in any missing fields.
	tg.assert("kind" in arg);
	const kind = arg.kind;
	switch (kind) {
		case "ld-linux": {
			const libraryPaths = arg.libraryPaths;
			const args = arg.args;
			const preloads = arg.preloads ?? [];

			// Find the artifact for the interpreter executable.
			const executable =
				arg.executable instanceof tg.Symlink
					? await arg.executable.resolve()
					: arg.executable;
			if (!executable || executable instanceof tg.Directory) {
				throw new Error("Could not resolve the symlink to the interpreter.");
			}
			tg.File.assert(executable);
			const interpreterMetadata = await std.file.executableMetadata(executable);
			if (interpreterMetadata.format !== "elf") {
				return tg.unreachable(
					"Cannot build an ld-linux interpreter for a non-ELF executable.",
				);
			}

			// If no preload is defined, add the default injection preload.
			if (preloads.length === 0) {
				const arch = interpreterMetadata.arch;
				const host = `${arch}-unknown-linux-gnu`;
				const detectedBuild = await std.triple.host();
				const buildOs = std.triple.os(detectedBuild);
				const buildToolchain = buildToolchainArg
					? buildToolchainArg
					: await std.env.arg(await tg.build(gnu.toolchain, { host }));
				const injectionLibrary = await injection.default({
					buildToolchain,
					build: buildOs === "darwin" ? detectedBuild : undefined,
					host,
				});

				preloads.push(injectionLibrary);
			}

			return {
				kind,
				executable,
				libraryPaths,
				preloads,
				args,
			};
		}
		case "ld-musl": {
			const libraryPaths = arg.libraryPaths;
			const args = arg.args;
			const preloads = arg.preloads ?? [];

			// Find the artifact for the interpreter executable.
			const executable =
				arg.executable instanceof tg.Symlink
					? await arg.executable.resolve()
					: arg.executable;
			if (!executable || executable instanceof tg.Directory) {
				throw new Error("Could not resolve the symlink to the interpreter.");
			}
			tg.File.assert(executable);
			const interpreterMetadata = await std.file.executableMetadata(executable);
			if (interpreterMetadata.format !== "elf") {
				return tg.unreachable(
					"Cannot build an ld-musl interpreter for a non-ELF executable.",
				);
			}

			// If no preload is defined, add the default injection preload.
			if (preloads.length === 0) {
				const arch = interpreterMetadata.arch;
				const host = `${arch}-linux-musl`;
				const buildToolchain = bootstrap.sdk.env(host);
				const injectionLibrary = await injection.default({
					buildToolchain,
					host,
				});
				preloads.push(injectionLibrary);
			}

			return {
				kind,
				executable,
				libraryPaths,
				preloads,
				args,
			};
		}
		case "dyld": {
			const libraryPaths = arg.libraryPaths;
			const preloads = arg.preloads ?? [];

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
				preloads.push(injectionLibrary);
			}

			return {
				kind,
				libraryPaths,
				preloads,
			};
		}
		case "normal": {
			return {
				kind,
				executable: arg.executable,
				args: arg.args,
			};
		}
		default: {
			return tg.unreachable(`unrecognized kind ${kind}`);
		}
	}
};

/** Inspect the executable and produce the corresponding interpreter. */
const interpreterFromExecutableArg = async (
	arg: string | tg.Template | tg.File | tg.Symlink,
	buildToolchainArg?: std.env.EnvObject,
): Promise<wrap.Interpreter | undefined> => {
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
			return interpreterFromElf(metadata, buildToolchainArg);
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
				preloads: [injectionDylib],
			};
		}
		case "shebang": {
			if (metadata.interpreter === undefined) {
				return interpreterFromArg(
					await wrap.defaultShell({ buildToolchain: buildToolchainArg }),
					buildToolchainArg,
				);
			} else {
				return undefined;
			}
		}
	}
};

/** Inspect an ELF file and produce the correct interpreter. */
const interpreterFromElf = async (
	metadata: std.file.ElfExecutableMetadata,
	buildToolchainArg?: std.env.EnvObject,
): Promise<wrap.Interpreter | undefined> => {
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
			: await std.env.arg(await tg.build(gnu.toolchain, { host }), {
					utils: false,
				});

	// Obtain injection library.
	const injectionLib = await injection.default({ buildToolchain, host });

	// Handle each interpreter type.
	if (metadata.interpreter?.includes("ld-linux")) {
		// Handle an ld-linux interpreter.
		const toolchainEnv = buildToolchainArg
			? buildToolchainArg
			: await std.env.arg(await tg.build(gnu.toolchain, { host }), {
					utils: false,
				});
		const { ldso, libDir } = await std.sdk.toolchainComponents({
			env: toolchainEnv,
		});
		tg.assert(
			ldso,
			"Could not find a valid ldso, required for Linux wrappers.",
		);
		return {
			kind: "ld-linux",
			executable: ldso,
			libraryPaths: [libDir],
			preloads: [injectionLib],
		};
	} else if (metadata.interpreter?.includes("ld-musl")) {
		// Handle an ld-musl interpreter.
		host = std.triple.create(host, { environment: "musl" });
		const muslArtifact = await bootstrap.musl.build({ host });
		const libDir = await muslArtifact.get("lib").then(tg.Directory.expect);
		const ldso = await libDir.get("libc.so").then(tg.File.expect);
		return {
			kind: "ld-musl",
			executable: ldso,
			libraryPaths: [libDir],
			preloads: [injectionLib],
		};
	} else {
		throw new Error(`Unsupported interpreter: "${metadata.interpreter}".`);
	}
};

type OptimizeLibraryPathsArg = {
	executable: string | tg.Template | tg.File | tg.Symlink;
	interpreter:
		| wrap.DyLdInterpreter
		| wrap.LdLinuxInterpreter
		| wrap.LdMuslInterpreter;
	libraryPaths?: Array<tg.Template.Arg> | undefined;
	libraryPathStrategy?: wrap.LibraryPathStrategy | undefined;
};

const optimizeLibraryPaths = async (
	arg: OptimizeLibraryPathsArg,
): Promise<
	wrap.DyLdInterpreter | wrap.LdLinuxInterpreter | wrap.LdMuslInterpreter
> => {
	const {
		interpreter,
		libraryPaths: additionalLibraryPaths = [],
		libraryPathStrategy: strategy = "unfilteredIsolate",
	} = arg;

	let executable = arg.executable;

	// Set up the initial set of paths.
	const paths = interpreter.libraryPaths ?? [];

	// If there are additional library paths, add them to the interpreter.
	if (additionalLibraryPaths.length > 0) {
		paths.push(...additionalLibraryPaths);
	}

	if (strategy === "none") {
		interpreter.libraryPaths = paths;
		return interpreter;
	}

	// If we're using the default strategy, optimize the paths and return before analyzing the executable.
	if (strategy === "unfilteredIsolate") {
		interpreter.libraryPaths = await separateLibraries(paths);
		return interpreter;
	}

	// Discover the containing directories of all transitively needed libraries.
	// If the arg is a string or template, there is no interpreter.
	if (typeof executable === "string" || executable instanceof tg.Template) {
		throw new Error("cannot optimize paths for a non-file executable");
	}

	// Resolve the arg to a file if it is a symlink.
	if (executable instanceof tg.Symlink) {
		const resolvedArg = await executable.resolve();
		tg.assert(resolvedArg instanceof tg.File);
		executable = resolvedArg;
	}

	// Prepare to map needed libraries to their locations.
	let neededLibraries = await getInitialNeededLibraries(executable);

	// Produce a set of the available library paths as directories with optional subpaths.
	const libraryPathSet = await createLibraryPathSet(paths);

	// Find any transitively needed libraries in the set and record their location.
	neededLibraries = await findTransitiveNeededLibraries(
		executable,
		libraryPathSet,
		neededLibraries,
	);

	// All optimization strategies required filtering first.
	const filtereredNeededLibraries: Map<string, DirWithSubpath> = new Map();
	neededLibraries.forEach((val, key) => {
		if (val !== undefined) {
			filtereredNeededLibraries.set(key, val);
		}
	});
	if (strategy === "filter") {
		return interpreter;
	}

	switch (strategy) {
		case "resolve": {
			interpreter.libraryPaths = await resolvePaths(libraryPathSet);
			break;
		}
		case "isolate": {
			const isolatedPaths: Array<tg.Directory> = [];
			for (let [name, referent] of filtereredNeededLibraries.entries()) {
				let innerDir = await getInner(referent);
				let libraryFile = await innerDir.tryGet(name);
				if (libraryFile !== undefined) {
					tg.File.assert(libraryFile);
					let isolatedDir = await tg.directory({ name: libraryFile });
					isolatedPaths.push(isolatedDir);
				}
				interpreter.libraryPaths = isolatedPaths;
			}
			break;
		}
		case "combine": {
			const entries: Record<string, tg.Artifact> = {};
			for (let [name, referent] of filtereredNeededLibraries.entries()) {
				let innerDir = await getInner(referent);
				let libraryFile = await innerDir.tryGet(name);
				if (libraryFile !== undefined) {
					tg.File.assert(libraryFile);
					entries[name] = libraryFile;
				}
				interpreter.libraryPaths = [await tg.directory(entries)];
			}
			break;
		}
		default: {
			throw new Error(`unexpected library path strategy: ${strategy}`);
		}
	}

	return interpreter;
};

const getInitialNeededLibraries = async (
	executable: tg.File,
): Promise<Map<string, DirWithSubpath | undefined>> => {
	const neededLibraries = new Map();
	const neededLibNames = await getNeededLibraries(executable);
	if (neededLibNames.length > 0) {
		for (let libName of neededLibNames) {
			// On macOS, libSystem is provided by the runtime.
			if (libName.includes("libSystem")) {
				continue;
			}
			neededLibraries.set(libName, undefined);
		}
	}

	return neededLibraries;
};

const getNeededLibraries = async (
	executable: tg.File,
): Promise<Array<string>> => {
	const metadata = await std.file.executableMetadata(executable);
	const fileName = (path: string) => path.split("/").pop();
	if (metadata.format === "mach-o") {
		return (metadata.dependencies ?? [])
			.map(fileName)
			.filter((el) => el !== undefined);
	} else if (metadata.format === "elf") {
		return (metadata.needed ?? [])
			.map(fileName)
			.filter((el) => el !== undefined);
	} else {
		throw new Error(
			"cannot determine needed libraries for non-ELF or Mach-O file",
		);
	}
};

type DirWithSubpath = {
	dir: tg.Directory;
	subpath?: string | undefined;
};

const createLibraryPathSet = async (
	libraryPaths: Array<tg.Template.Arg>,
): Promise<Set<DirWithSubpath>> => {
	const set: Set<DirWithSubpath> = new Set();

	for (let path of libraryPaths) {
		if (path instanceof tg.Directory) {
			set.add({ dir: path });
		}
		if (path instanceof tg.Template) {
			const maybeResult = await tryTemplateToDirWithSubpath(path);
			if (maybeResult !== undefined) {
				set.add(maybeResult);
			}
		}
		if (path instanceof tg.Symlink) {
			const artifact = await path.artifact();
			if (artifact !== undefined) {
				tg.Directory.assert(artifact);
				let ret: DirWithSubpath = { dir: artifact };
				const subpath = await path.subpath();
				if (subpath !== undefined) {
					ret = { ...ret, subpath };
				}
				set.add(ret);
			}
		}
		if (path instanceof tg.File) {
			await path.store();
			throw new Error(`found a file in the library paths:  ${path.id}`);
		}
	}

	return set;
};

/** If the template represetns a directory and optional subpath, return it. Otherwise, undefined. */
const tryTemplateToDirWithSubpath = async (
	t: tg.Template,
): Promise<DirWithSubpath | undefined> => {
	const components = await t.components;
	const numComponents = components.length;
	if (numComponents === 1) {
		// Make sure the first component is a directory.
		const component = components[0];
		if (component instanceof tg.Directory) {
			return {
				dir: component,
			};
		} else {
			return undefined;
		}
	}
	if (numComponents === 2) {
		const first = components[0];
		const second = components[1];
		// If the first is a string, assume the second is a directory.
		if (typeof first === "string") {
			if (second instanceof tg.Directory) {
				return {
					dir: second,
				};
			} else {
				return undefined;
			}
		}
		if (first instanceof tg.Directory) {
			if (typeof second === "string") {
				return {
					dir: first,
					subpath: second.slice(1),
				};
			} else {
				return undefined;
			}
		}
		return undefined;
	}
	if (numComponents === 3) {
		const first = components[0];
		const second = components[1];
		const third = components[2];
		// With three, the first must be a string we discard, the second must be a directory, and the third must be a string subpath.
		if (
			typeof first === "string" &&
			second instanceof tg.Directory &&
			typeof third === "string"
		) {
			return {
				dir: second,
				subpath: third.slice(1),
			};
		} else {
			return undefined;
		}
	}
	return undefined;
};

const findTransitiveNeededLibraries = async (
	executable: tg.File,
	libraryPaths: Set<DirWithSubpath>,
	neededLibraries: Map<string, DirWithSubpath | undefined>,
) => {
	return findTransitiveNeededLibrariesInner(
		executable,
		libraryPaths,
		neededLibraries,
		0,
	);
};

const findTransitiveNeededLibrariesInner = async (
	executable: tg.File,
	libraryPaths: Set<DirWithSubpath>,
	neededLibraries: Map<string, DirWithSubpath | undefined>,
	depth: number,
) => {
	const maxDepth = 16;

	// Check if we're done.
	if (foundAllLibraries(neededLibraries) || depth === maxDepth) {
		return neededLibraries;
	}

	// Check for transitive dependencies if we've recurred beyond the initial file.
	if (depth > 0) {
		// get new needed libraries. add them to the neededLibraries set.
		const neededLibNames = await getNeededLibraries(executable);
		for (let lib of neededLibNames) {
			if (!neededLibraries.has(lib)) {
				neededLibraries.set(lib, undefined);
			}
		}
	}

	// Locate and record found libraries.
	for (let referent of libraryPaths) {
		const directory = await getInner(referent);
		const copiedNeededLibraryNames = Array.from(neededLibraries.keys());
		// Search dir for names.
		for (let libName of copiedNeededLibraryNames) {
			// If already found, skip it.
			if (neededLibraries.get(libName) !== undefined) {
				continue;
			}
			// Otherwise, check if it's here.
			const maybeLibFile = await directory.tryGet(libName);
			if (maybeLibFile !== undefined && maybeLibFile instanceof tg.File) {
				// We found it! Record the location, and recurse.
				neededLibraries.set(libName, referent);
				neededLibraries = await findTransitiveNeededLibrariesInner(
					maybeLibFile,
					libraryPaths,
					neededLibraries,
					depth + 1,
				);
				// If we're done now, quit.
				if (foundAllLibraries(neededLibraries)) {
					return neededLibraries;
				}
			}
		}
	}

	return neededLibraries;
};

/** Did we find an entry for every name in the needed libraries set? */
const foundAllLibraries = (
	neededLibraries: Map<string, DirWithSubpath | undefined>,
) => {
	return Array.from(neededLibraries.values()).every(
		(value) => value !== undefined,
	);
};

/** Resovle all subpaths to the inner directory. */
const resolvePaths = async (
	paths: Set<DirWithSubpath>,
): Promise<Array<tg.Directory>> => {
	return await Promise.all([...paths].map(getInner));
};

const getInner = async (
	dirWithSubpath: DirWithSubpath,
): Promise<tg.Directory> => {
	const directory = dirWithSubpath.dir;
	let subpath = dirWithSubpath.subpath;
	if (subpath === undefined) {
		return directory;
	}
	if (subpath.startsWith("/")) {
		subpath = subpath.slice(1);
	}
	const inner = await directory.tryGet(subpath);
	if (inner !== undefined) {
		if (inner instanceof tg.Directory) {
			return inner;
		}
		const id = inner.id;
		throw new Error(`expected a directory, got ${id}`);
	} else {
		throw new Error(`could not get ${inner} from ${directory.id}`);
	}
};

/** Given a list of library paths, find all actual files and produce a new list containing directories with a single entry. */
const separateLibraries = async (
	orig: Array<tg.Template.Arg>,
): Promise<Array<tg.Directory>> => {
	const foundFiles: Array<[string, tg.File]> = [];
	const fileName = (path: string) => path.split("/").pop();
	const isDylib = (name: string) =>
		name.includes(".so") || name.includes(".dylib");
	for (let pathTemplate of orig) {
		const dirWithSubpath = await tryTemplateToDirWithSubpath(
			await tg.template(pathTemplate),
		);
		if (dirWithSubpath === undefined) {
			continue;
		}
		const inner = await getInner(dirWithSubpath);
		for await (let [name, artifact] of inner) {
			if (artifact instanceof tg.File && isDylib(name)) {
				const metadata = await std.file.tryExecutableMetadata(artifact);
				if (metadata === undefined) {
					continue;
				}
				let dylibName = name;
				if (metadata.format === "elf" && metadata.soname !== undefined) {
					dylibName = metadata.soname;
				}
				if (
					metadata.format === "mach-o" &&
					metadata.installName !== undefined
				) {
					const installFileName = fileName(metadata.installName);
					if (installFileName !== undefined) {
						dylibName = installFileName;
					}
				}
				foundFiles.push([dylibName, artifact]);
			}
		}
	}

	return await Promise.all(
		Array.from(foundFiles).map(
			async ([name, file]) => await tg.directory({ [name]: file }),
		),
	);
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
	} else if (mutation.inner.kind === "merge") {
		const value = mutation.inner.value;
		tg.assert(tg.Value.isMap(value), "expected a map");
		const manifestValue = await manifestValueFromValue(value);
		tg.assert(
			manifestValue !== undefined &&
				typeof manifestValue === "object" &&
				!Array.isArray(manifestValue) &&
				manifestValue.kind === "map",
		);
		return { kind: "merge", value: manifestValue };
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
			component instanceof tg.Directory ? component.id : component;
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
): Promise<tg.Mutation> => {
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
	} else if (manifestMutation.kind === "merge") {
		const value = valueFromManifestValue(manifestMutation.value).then((v) => {
			tg.assert(tg.Value.isMap(v));
			return v;
		});
		return tg.Mutation.merge(value);
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
		await value.store();
		return { kind: "directory", value: value.id };
	} else if (value instanceof tg.File) {
		await value.store();
		return { kind: "file", value: value.id };
	} else if (value instanceof tg.Symlink) {
		await value.store();
		return { kind: "symlink", value: value.id };
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
	yield* std.env.envVars(await wrap.envObjectFromManifestEnv(manifest.env));
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
				await component.store();
				return { kind: "artifact", value: component.id };
			}
		}),
	);
	return {
		components: components ?? [],
	};
};

const envObjectFromMapValue = async (
	value: wrap.Manifest.Value,
): Promise<std.env.EnvObject> => {
	tg.assert(
		!(value instanceof Array) &&
			typeof value === "object" &&
			value.kind === "map",
		"Malformed env, expected a map of mutations.",
	);
	const ret: std.env.EnvObject = {};
	for (const [key, val] of Object.entries(value.value)) {
		if (val instanceof Array) {
			return tg.unreachable();
		} else if (typeof val === "object" && val.kind === "mutation") {
			ret[key] = (await mutationFromManifestMutation(
				val.value,
			)) as tg.Mutation<tg.Template.Arg>;
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
export const argAndEnvDump = async () => {
	const sdkEnv = await std.env.arg(
		bootstrap.sdk(),
		{
			TANGRAM_LINKER_TRACING: "tangram_ld_proxy=trace",
		},
		{ utils: false },
	);

	return await std.build`cc -xc ${inspectProcessSource} -o $OUTPUT`
		.bootstrap(true)
		.env(sdkEnv)
		.then(tg.File.expect);
};

export const test = async () => {
	await Promise.all([
		testSingleArgObjectNoMutations(),
		testDependencies(),
		testDylibPath(),
		testContentExecutable(),
		testContentExecutableVariadic(),
	]);
	return true;
};

export const testSingleArgObjectNoMutations = async () => {
	const executable = await argAndEnvDump();
	await executable.store();
	const executableID = executable.id;
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
	await origExecutable.store();
	const origExecutableId = origExecutable.id;
	console.log("origExecutable", origExecutableId);

	const buildToolchain = await bootstrap.sdk.env(await std.triple.host());

	const wrapper = await wrap(executable, {
		args: ["--arg1", "--arg2"],
		buildToolchain,
		env: {
			HELLO: "WORLD",
		},
	});
	await wrapper.store();
	const wrapperID = wrapper.id;
	console.log("wrapper id", wrapperID);

	// Check the manifest can be deserialized properly.
	const manifest = await wrap.Manifest.read(wrapper);
	console.log("wrapper manifest", manifest);
	tg.assert(manifest);
	tg.assert(manifest.identity === "executable");
	tg.assert(manifest.interpreter);

	// Check the output matches the expected output.
	const output = await std.build`${wrapper} > $OUTPUT`
		.bootstrap(true)
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
};

export const testContentExecutable = async () => {
	const buildToolchain = bootstrap.sdk();
	const wrapper = await std.wrap({
		buildToolchain,
		executable: `echo $NAME`,
		env: {
			NAME: "Tangram",
		},
	});

	await wrapper.store();
	console.log("wrapper", wrapper.id);
	// Check the output matches the expected output.
	const output = await std.build`set -x; ${wrapper} > $OUTPUT`
		.env({ TANGRAM_WRAPPER_TRACING: "tangram_wrapper=trace" })
		.bootstrap(true)
		.then(tg.File.expect);
	const text = await output.text().then((t) => t.trim());
	console.log("text", text);
	tg.assert(text.includes("Tangram"));

	return true;
};

export const testContentExecutableVariadic = async () => {
	const buildToolchain = bootstrap.sdk();
	const wrapper = await std.wrap(
		`echo "$NAME"`,
		{ env: { NAME: "Tangram" } },
		{
			buildToolchain,
		},
	);
	await wrapper.store();
	console.log("wrapper", wrapper.id);
	// Check the output matches the expected output.
	const output = await std.build`set -x; ${wrapper} > $OUTPUT`
		.env({ TANGRAM_WRAPPER_TRACING: "tangram_wrapper=trace" })
		.bootstrap(true)
		.then(tg.File.expect);
	const text = await output.text().then((t) => t.trim());
	console.log("text", text);
	tg.assert(text.includes("Tangram"));

	return true;
};

export const testDependencies = async () => {
	const buildToolchain = await bootstrap.sdk.env(await std.triple.host());
	const transitiveDependency = await tg.file("I'm a transitive reference");
	await transitiveDependency.store();
	const transitiveDependencyId = transitiveDependency.id;
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
	await binDir.store();
	console.log("binDir", binDir.id);

	const bootstrapShell = await bootstrap.shell();
	const shellExe = await bootstrapShell.get("bin/sh").then(tg.File.expect);

	const wrapper = await std.wrap({
		buildToolchain,
		executable: shellExe,
		env: {
			PATH: tg`${binDir}/bin`,
		},
	});
	await wrapper.store();
	console.log("wrapper", wrapper.id);
	const wrapperDependencies = await wrapper.dependencies();
	console.log("wrapperDependencies", wrapperDependencies);

	// return wrapper;

	const bundle = tg.bundle(await tg.directory({ wrapper }));
	return bundle;
};

import libGreetSource from "./wrap/test/greet.c" with { type: "file" };
import driverSource from "./wrap/test/driver.c" with { type: "file" };
export const testDylibPath = async () => {
	const host = await std.triple.host();
	const os = std.triple.os(host);
	const dylibExt = os === "darwin" ? "dylib" : "so";

	// Obtain a non-proxied toolchain env from the bootstrap
	const bootstrapSdk = bootstrap.sdk.env(host);

	// Compile the greet library
	const sharedLibraryDir =
		await std.build`mkdir -p $OUTPUT/lib && cc -shared -fPIC -xc -o $OUTPUT/lib/libgreet.${dylibExt} ${libGreetSource}`
			.bootstrap(true)
			.env(bootstrapSdk)
			.then(tg.Directory.expect);
	await sharedLibraryDir.store();
	console.log("sharedLibraryDir", sharedLibraryDir.id);

	// Compile the driver.
	const driver = await std.build`cc -xc -o $OUTPUT ${driverSource} -ldl`
		.bootstrap(true)
		.env(bootstrapSdk)
		.then(tg.File.expect);
	await driver.store();
	console.log("unwrapped driver", driver.id);

	// Wrap the driver with just the interpreter.
	const interpreterWrapper = await wrap(driver, {
		buildToolchain: bootstrapSdk,
		env: { FOO: "bar" },
	});
	await interpreterWrapper.store();
	console.log("interpreterWrapper", interpreterWrapper.id);

	// Re-wrap the driver program with the library path.
	const libraryPathWrapper = await wrap(interpreterWrapper, {
		buildToolchain: bootstrapSdk,
		libraryPaths: [tg`${sharedLibraryDir}/lib`],
	});
	await libraryPathWrapper.store();
	console.log("libraryPathWrapper", libraryPathWrapper.id);
	return libraryPathWrapper;
};
