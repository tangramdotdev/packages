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

	// Check if the executable is already a wrapper and get its manifest
	const [binary, existingManifest] = await wrap
		.splitManifestFromExecutableArg(arg.executable)
		.then((r) => (r ? r : [undefined, undefined]));

	const executable =
		existingManifest?.executable ??
		(await manifestExecutableFromArg(arg.executable));
	const host = arg.host ?? (await std.triple.host());
	std.triple.assert(host);

	const buildTriple = arg.build ?? host;
	std.triple.assert(buildTriple);

	// Construct the interpreter.
	// Cases:
	// - the user provided an interpreter argument.
	// - the interpreter argument is incomplete, and we need to infer the interpreter.
	// - there was an interpreter in the original manifest.
	// - there is no interpreter arg and no original manifest.
	let manifestInterpreter = undefined;
	if (arg.interpreter) {
		manifestInterpreter = await manifestInterpreterFromWrapArgObject({
			buildToolchain: arg.buildToolchain,
			build: buildTriple,
			host,
			interpreter: arg.interpreter,
			executable: undefined,
			libraryPaths: arg.libraryPaths,
			libraryPathStrategy: arg.libraryPathStrategy,
			preloads: arg.preloads,
		});
	} else if (existingManifest?.interpreter) {
		manifestInterpreter = existingManifest?.interpreter;
	} else if (arg.executable && typeof arg.executable !== "number") {
		manifestInterpreter = await manifestInterpreterFromWrapArgObject({
			buildToolchain: arg.buildToolchain,
			build: buildTriple,
			host,
			interpreter: undefined,
			executable: arg.executable,
			libraryPaths: arg.libraryPaths,
			libraryPathStrategy: arg.libraryPathStrategy,
			preloads: arg.preloads,
		});
	}

	// Use existing manifest values as defaults if we're wrapping a wrapper
	const manifestEnv = await wrap.manifestEnvFromEnvObject(
		arg.env as std.env.EnvObject,
	);
	const manifestArgs = await Promise.all(
		(arg.args ?? []).map(manifestTemplateFromArg),
	);

	const manifest: wrap.Manifest = {
		interpreter: manifestInterpreter,
		executable,
		env:
			existingManifest?.env &&
			manifestEnv &&
			Object.keys(manifestEnv).length === 0
				? existingManifest.env
				: manifestEnv,
		args:
			manifestArgs.length === 0 && existingManifest?.args
				? existingManifest.args
				: manifestArgs,
	};

	// Get the wrapper executable.
	const detectedOs = std.triple.os(buildTriple);
	const build =
		detectedOs === "linux"
			? await bootstrap.toolchainTriple(buildTriple)
			: buildTriple;

	// If there's an existing binary, use it.
	if (binary) {
		return wrap.Manifest.write(binary, manifest);
	} else {
		// We can't wrap a non-existent binary with a manifest specifying an address.
		if (manifest.executable.kind === "address") {
			throw new Error("invalid manifest");
		}
		// Use default wrapper when no custom build or host is provided.
		let wrapper =
			arg.build === undefined && arg.host === undefined
				? await tg.build(workspace.defaultWrapper)
				: await workspace.wrapper({
						build,
						host,
					});
		return wrap.Manifest.write(wrapper, manifest);
	}
}

export default wrap;

export namespace wrap {
	export type Arg = string | tg.Template | tg.File | tg.Symlink | ArgObject;

	export type ArgObject = {
		/** Command line arguments to bind to the wrapper. If the executable is wrapped, they will be merged. */
		args?: Array<tg.Template.Arg>;

		/** The machine to build the wrapper on. */
		build?: string;

		/** The build toolchain to use to produce components. Will use the default for the system if not provided. */
		buildToolchain?: std.env.Arg | undefined;

		/** Experimental: embed the manifest and wrapper logic into the binary. */
		embed?: boolean;

		/** Environment variables to bind to the wrapper. If the executable is wrapped, they will be merged. */
		env?: std.env.Arg;

		/** The executable to wrap. */
		executable?: string | tg.Template | tg.File | tg.Symlink | number;

		/** The host system to produce a wrapper for. */
		host?: string;

		/** The interpreter to run the executable with. If not provided, a default is detected. */
		interpreter?: tg.File | tg.Symlink | tg.Template | Interpreter | undefined;

		/** Library paths to include. If the executable is wrapped, they will be merged. */
		libraryPaths?: Array<tg.Directory | tg.Symlink | tg.Template>;

		/** Which library path strategy should we use? The default is "unfilteredIsolate", which separates libraries into individual directories. */
		libraryPathStrategy?: LibraryPathStrategy | undefined;

		/** Preloads to include. If the executable is wrapped, they will be merged. */
		preloads?: Array<tg.File | tg.Symlink | tg.Template>;

		/** Specify how to handle executables that are already Tangram wrappers. When `merge` is true, retain the original executable in the resulting manifest. When `merge` is set to false, produce a manifest pointing to the original wrapper. This option is ignored if the executable being wrapped is not a Tangram wrapper. Default: true. */
		merge?: boolean;
	};

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
			build: build_,
			buildToolchain,
			env: env_ = {},
			executable,
			host: host_,
			interpreter,
			merge: merge_ = true,
			libraryPaths = [],
			libraryPathStrategy,
			preloads = [],
		} = await std.args.apply<wrap.Arg, wrap.ArgObject>({
			args,
			map: async (arg) => {
				if (arg === undefined) {
					return {};
				} else if (arg instanceof tg.File || arg instanceof tg.Symlink) {
					return { executable: arg };
				} else if (typeof arg === "string" || arg instanceof tg.Template) {
					// This is a "content" executable. The interpreter will be inferred.
					return {
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
				preloads: "append",
				args: "append",
			},
		});

		tg.assert(executable !== undefined);

		// Determine the host. If it was not provided, detect the executable host if it's a file, and fall back to the detected host.
		const detectedHost = await std.triple.host();
		let host = host_;
		if (host === undefined) {
			if (executable instanceof tg.File) {
				try {
					const metadata = await std.file.executableMetadata(executable);
					let os;
					let arch;
					if (metadata.format === "mach-o") {
						os = "darwin";
						if (metadata.arches.length === 1) {
							arch = metadata.arches[0];
							tg.assert(arch);
							host = std.triple.fromComponents({ arch, os });
						} else {
							// Check if the detected arch matches any. Error if not?
							const detectedArch = std.triple.arch(detectedHost);
							if (metadata.arches.includes(detectedArch)) {
								arch = detectedArch;
								host = std.triple.fromComponents({ arch, os });
							} else {
								const id = await executable.store();
								throw new Error(
									`fat binary detected containing only unsupported architectures: ${id}`,
								);
							}
						}
					} else if (metadata.format === "elf") {
						os = "linux";
						arch = metadata.arch;
						host = std.sdk.canonicalTriple(
							std.triple.fromComponents({ arch, os }),
						);
					} else {
						host = detectedHost;
					}
				} catch (_) {
					host = detectedHost;
				}
			} else {
				host = detectedHost;
			}
		}
		tg.assert(host !== undefined);
		const build = build_ ?? detectedHost;

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

			// Merge the existing interpreter with any new interpreter provided
			const existingInterpreter = await wrap.interpreterFromManifestInterpreter(
				existingManifest.interpreter,
			);
			if (interpreter !== undefined) {
				const newInterpreter = await interpreterFromArg(
					interpreter,
					buildToolchain,
					build,
					host,
				);
				interpreter = await wrap.mergeInterpreters(
					existingInterpreter,
					newInterpreter,
				);
			} else {
				interpreter = existingInterpreter;
			}

			// TODO: figure this API out a little better.
			if (existingManifest.executable.kind !== "address") {
				executable = await wrap.executableFromManifestExecutable(
					existingManifest.executable,
				);
			}

			args_ = (args_ ?? []).concat(
				await Promise.all(
					(existingManifest.args ?? []).map(templateFromManifestTemplate),
				),
			);
		}

		const env = await std.env.arg(...envs, env_, { utils: false });

		// If the executable is a content executable, make sure there is a normal interpreter for it.
		if (executable instanceof tg.Template || typeof executable === "string") {
			if (interpreter === undefined) {
				interpreter = await wrap.defaultShell({ buildToolchain, build, host });
			}
		}

		return {
			args: args_,
			build,
			buildToolchain,
			env,
			executable,
			host,
			interpreter,
			merge,
			libraryPaths,
			libraryPathStrategy,
			preloads,
		};
	};

	export type DefaultShellArg = {
		/** The toolchain to use to build constituent components. Default: `std.sdk()`. */
		buildToolchain?: std.env.Arg | undefined;
		/* Build machine. */
		build?: string;
		/** Should scripts treat unset variables as errors? Equivalent to setting `-u`. Default: true. */
		disallowUnset?: boolean;
		/** Should scripts exit on errors? Equivalent to setting `-e`. Default: true. */
		exitOnErr?: boolean;
		/** Whether to incldue the complete `std.utils()` environment. Default: true. */
		includeUtils?: boolean;
		/** Host machine */
		host?: string;
		/** Should failures inside pipelines cause the whole pipeline to fail? Equivalent to setting `-o pipefail`. Default: true. */
		pipefail?: boolean;
	};

	/** Helper to configure a `bash` executable to use as the interpreter for content executables. */
	export const defaultShell = async (arg?: DefaultShellArg) => {
		const {
			buildToolchain: buildToolchain_,
			build: build_,
			disallowUnset = true,
			exitOnErr = true,
			includeUtils = true,
			host: host_,
			pipefail = true,
		} = arg ?? {};

		const host = host_ ?? (await std.triple.host());
		const build = build_ ?? host;

		// Provide bash for the detected host system.
		let buildArg: {
			build: string;
			host: string;
			bootstrap?: boolean;
			env?: tg.Unresolved<std.env.Arg>;
		} = { build, host };
		if (buildToolchain_) {
			buildArg = { ...buildArg, bootstrap: true, env: buildToolchain_ };
		} else {
			buildArg = { ...buildArg, bootstrap: true, env: await tg.build(std.sdk) };
		}
		const shellExecutable = await std.utils.bash
			.build(buildArg)
			.then((artifact) => artifact.get("bin/bash"))
			.then(tg.File.expect);

		const wrapArgs: Array<wrap.Arg> = [
			{
				executable: shellExecutable,
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

	/** Utility to split a wrapped binary into its original executable and manifest, if it exists. */
	export const splitManifestFromExecutableArg = async (
		executable:
			| undefined
			| number
			| string
			| tg.Template
			| tg.File
			| tg.Symlink,
	): Promise<[tg.File, wrap.Manifest] | undefined> => {
		let ret = undefined;

		if (executable instanceof tg.File || executable instanceof tg.Symlink) {
			const f =
				executable instanceof tg.Symlink
					? await executable.resolve()
					: executable;
			if (f instanceof tg.File) {
				ret = wrap.Manifest.split(f);
			}
		}
		return ret;
	};

	/** Utility to retrieve the existing manifest from an exectuable arg, if it's a wrapper. If not, returns `undefined`. */
	export const existingManifestFromExecutableArg = async (
		executable:
			| undefined
			| number
			| string
			| tg.Template
			| tg.File
			| tg.Symlink,
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

	/** Merge two interpreters, with the new interpreter's properties taking precedence but arrays being concatenated. */
	export const mergeInterpreters = async (
		existingInterpreter: wrap.Interpreter | undefined,
		newInterpreter: wrap.Interpreter | undefined,
	): Promise<wrap.Interpreter | undefined> => {
		// If no existing interpreter, just return the new one
		if (!existingInterpreter) {
			return newInterpreter;
		}

		// If no new interpreter, just return the existing one
		if (!newInterpreter) {
			return existingInterpreter;
		}

		// Both interpreters must be the same kind to merge
		if (existingInterpreter.kind !== newInterpreter.kind) {
			return newInterpreter; // New interpreter completely replaces existing one
		}

		const kind = existingInterpreter.kind;

		switch (kind) {
			case "normal": {
				const existing = existingInterpreter as wrap.NormalInterpreter;
				const new_ = newInterpreter as wrap.NormalInterpreter;
				return {
					kind,
					// New executable takes precedence
					executable: new_.executable ?? existing.executable,
					// Concatenate args arrays
					args:
						[...(existing.args ?? []), ...(new_.args ?? [])].length > 0
							? [...(existing.args ?? []), ...(new_.args ?? [])]
							: undefined,
				};
			}
			case "ld-linux": {
				const existing = existingInterpreter as wrap.LdLinuxInterpreter;
				const new_ = newInterpreter as wrap.LdLinuxInterpreter;
				return {
					kind,
					// New executable takes precedence
					executable: new_.executable ?? existing.executable,
					// Concatenate libraryPaths arrays
					libraryPaths:
						[...(existing.libraryPaths ?? []), ...(new_.libraryPaths ?? [])]
							.length > 0
							? [...(existing.libraryPaths ?? []), ...(new_.libraryPaths ?? [])]
							: undefined,
					// Concatenate preloads arrays
					preloads:
						[...(existing.preloads ?? []), ...(new_.preloads ?? [])].length > 0
							? [...(existing.preloads ?? []), ...(new_.preloads ?? [])]
							: undefined,
					// Concatenate args arrays
					args:
						[...(existing.args ?? []), ...(new_.args ?? [])].length > 0
							? [...(existing.args ?? []), ...(new_.args ?? [])]
							: undefined,
				};
			}
			case "ld-musl": {
				const existing = existingInterpreter as wrap.LdMuslInterpreter;
				const new_ = newInterpreter as wrap.LdMuslInterpreter;
				return {
					kind,
					// New executable takes precedence
					executable: new_.executable ?? existing.executable,
					// Concatenate libraryPaths arrays
					libraryPaths:
						[...(existing.libraryPaths ?? []), ...(new_.libraryPaths ?? [])]
							.length > 0
							? [...(existing.libraryPaths ?? []), ...(new_.libraryPaths ?? [])]
							: undefined,
					// Concatenate preloads arrays
					preloads:
						[...(existing.preloads ?? []), ...(new_.preloads ?? [])].length > 0
							? [...(existing.preloads ?? []), ...(new_.preloads ?? [])]
							: undefined,
					// Concatenate args arrays
					args:
						[...(existing.args ?? []), ...(new_.args ?? [])].length > 0
							? [...(existing.args ?? []), ...(new_.args ?? [])]
							: undefined,
				};
			}
			case "dyld": {
				const existing = existingInterpreter as wrap.DyLdInterpreter;
				const new_ = newInterpreter as wrap.DyLdInterpreter;
				return {
					kind,
					// Concatenate libraryPaths arrays
					libraryPaths:
						[...(existing.libraryPaths ?? []), ...(new_.libraryPaths ?? [])]
							.length > 0
							? [...(existing.libraryPaths ?? []), ...(new_.libraryPaths ?? [])]
							: undefined,
					// Concatenate preloads arrays
					preloads:
						[...(existing.preloads ?? []), ...(new_.preloads ?? [])].length > 0
							? [...(existing.preloads ?? []), ...(new_.preloads ?? [])]
							: undefined,
				};
			}
			default: {
				return tg.unreachable(`Unexpected interpreter kind ${kind}`);
			}
		}
	};

	export const executableFromManifestExecutable = async (
		manifestExecutable: wrap.Manifest.Executable,
	): Promise<number | tg.Template | tg.File | tg.Symlink> => {
		if (manifestExecutable.kind === "content") {
			return templateFromManifestTemplate(manifestExecutable.value);
		} else if (manifestExecutable.kind === "path") {
			return fileOrSymlinkFromManifestTemplate(manifestExecutable.value);
		} else {
			return manifestExecutable.value;
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
			wrappedExecutable.kind === "path",
			"cannot determine needed libraries for a content executable",
		);
		if (wrappedExecutable.kind !== "path") {
			return [];
		}
		tg.assert(manifest.executable.kind !== "address");
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
		const fileAndManifest = await wrap.Manifest.split(file);
		if (!fileAndManifest) {
			throw new Error(`Cannot unwrap ${file.id}: not wrapped executable.`);
		}
		const [bin, manifest] = fileAndManifest;
		if (manifest.executable.kind === "content") {
			return templateFromManifestTemplate(manifest.executable.value);
		} else if (manifest.executable.kind == "path") {
			return fileOrSymlinkFromManifestTemplate(manifest.executable.value);
		} else if (manifest.executable.kind == "address") {
			return bin;
		} else {
			throw new Error("could not extract original executable");
		}
	};

	export namespace Manifest {
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
			| { kind: "address"; value: number }
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

		/** Split a manifest from the end of a file. */
		export const split = async (
			file: tg.File,
		): Promise<[tg.File, wrap.Manifest] | undefined> => {
			// Read the magic number.
			const magicNumberBytes = await file.read({
				position: `end.-8`,
				length: 8,
			});
			for (let i = 0; i < MANIFEST_MAGIC_NUMBER.length; i++) {
				if (magicNumberBytes[i] !== MANIFEST_MAGIC_NUMBER[i]) {
					return undefined;
				}
			}

			// Read the version.
			const versionBytes = await file.read({
				position: `end.-16`,
				length: 8,
			});
			const version = Number(
				new DataView(versionBytes.buffer).getBigUint64(0, true),
			);

			if (version === MANIFEST_VERSION_0) {
				// Read the manifest length.
				const lengthBytes = await file.read({
					position: `end.-24`,
					length: 8,
				});
				const length = Number(
					new DataView(lengthBytes.buffer).getBigUint64(0, true),
				);

				// Read the manifest.
				const manifestBytes = await file.read({
					position: `end.-${length + 24}`,
					length,
				});

				// Deserialize the manifest.
				const manifestString = tg.encoding.utf8.decode(manifestBytes);
				const manifest = tg.encoding.json.decode(
					manifestString,
				) as wrap.Manifest;

				// Reconstruct the original file.
				let bytes = (await file.bytes()).slice(
					0,
					(await file.length()) - (length + 24),
				);
				let new_file = await tg.file(bytes, {
					executable: true,
					dependencies: await file.dependencies(),
				});

				return [new_file, manifest];
			} else {
				return undefined;
			}
		};

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
			if (version === MANIFEST_VERSION_0) {
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
				const manifest = tg.encoding.json.decode(
					manifestString,
				) as wrap.Manifest;
				return manifest;
			} else {
				throw new Error(
					`unknown manifest version number ${MANIFEST_VERSION_0}`,
				);
			}
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
				BigInt(MANIFEST_VERSION_0),
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
				dependencies[dependency] = { item, options: {} };
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

const MANIFEST_VERSION_0 = 0;

const manifestExecutableFromArg = async (
	arg:
		| number
		| string
		| tg.Template
		| tg.File
		| tg.Symlink
		| wrap.Manifest.Executable,
): Promise<wrap.Manifest.Executable> => {
	if (typeof arg === "number") {
		return {
			kind: "address",
			value: arg,
		};
	} else if (isManifestExecutable(arg)) {
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
	buildToolchain?: std.env.Arg | undefined;
	build?: string;
	host?: string;
	interpreter?:
		| tg.File
		| tg.Symlink
		| tg.Template
		| wrap.Interpreter
		| undefined;
	executable?: string | tg.Template | tg.File | tg.Symlink | undefined;
	libraryPaths?: Array<tg.Template.Arg> | undefined;
	libraryPathStrategy?: wrap.LibraryPathStrategy | undefined;
	preloads?: Array<tg.File | tg.Symlink | tg.Template> | undefined;
};

/** Compute the buildToolchain, using the provided value or computing a default. */
const getBuildToolchain = async (
	buildToolchain: std.env.Arg | undefined,
	build: string,
	host: string,
): Promise<std.env.Arg> => {
	if (buildToolchain !== undefined) {
		return buildToolchain;
	}
	return std.triple.os(host) === "linux"
		? await std.env.arg(
				await tg.build(gnu.toolchain, { host: build, target: host }),
				{ utils: false },
			)
		: await bootstrap.sdk.env(host);
};

/** Produce the manifest interpreter object given a set of parameters. */
const manifestInterpreterFromWrapArgObject = async (
	arg: ManifestInterpreterArg,
): Promise<wrap.Manifest.Interpreter | undefined> => {
	let interpreter = arg.interpreter
		? await interpreterFromArg(
				arg.interpreter,
				arg.buildToolchain,
				arg.build,
				arg.host,
			)
		: await interpreterFromExecutableArg(
				arg.executable,
				arg.buildToolchain,
				arg.build,
				arg.host,
			);
	if (interpreter === undefined) {
		return undefined;
	}

	// If this is not a "normal" interpreter run the library path optimization, including any additional paths from the user.
	if (interpreter.kind !== "normal") {
		const { executable, libraryPaths, libraryPathStrategy, preloads } = arg;
		interpreter = await optimizeLibraryPaths({
			executable,
			interpreter,
			libraryPaths,
			libraryPathStrategy,
		});

		// Add any additional preloads from the arg
		if (preloads && preloads.length > 0) {
			// Merge with existing preloads
			const existingPreloads = interpreter.preloads ?? [];
			interpreter = {
				...interpreter,
				preloads: [...existingPreloads, ...preloads],
			};
		}
	}

	return interpreter
		? manifestInterpreterFromWrapInterpreter(interpreter)
		: undefined;
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
	buildToolchainArg?: std.env.Arg,
	buildArg?: string,
	hostArg?: string,
): Promise<wrap.Interpreter> => {
	const host = hostArg ?? (await std.triple.host());
	const buildTriple = buildArg ?? host;
	// If the arg is an executable, then wrap it and create a normal interpreter.
	if (
		arg instanceof tg.File ||
		arg instanceof tg.Symlink ||
		arg instanceof tg.Template
	) {
		const executable = await tg.build(std.wrap, {
			buildToolchain: buildToolchainArg,
			build: buildTriple,
			host,
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
				const build = buildArg ?? detectedBuild;
				const buildToolchain = await getBuildToolchain(
					buildToolchainArg,
					build,
					host,
				);
				const injectionLibrary = await tg.build(injection.injection, {
					buildToolchain,
					build,
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
				const detectedBuild = await std.triple.host();
				const build = buildArg ?? detectedBuild;
				const buildToolchain = await getBuildToolchain(
					buildToolchainArg,
					build,
					host,
				);
				const injectionLibrary = await tg.build(injection.injection, {
					buildToolchain,
					build,
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
				// Use default injection when no custom build or buildToolchain is provided.
				if (buildArg === undefined && buildToolchainArg === undefined) {
					const injectionLibrary = await tg.build(injection.defaultInjection);
					preloads.push(injectionLibrary);
				} else {
					const build = buildArg ?? host;
					const buildToolchain = await getBuildToolchain(
						buildToolchainArg,
						build,
						host,
					);
					const injectionLibrary = await tg.build(injection.injection, {
						buildToolchain,
						build: buildArg,
						host,
					});
					preloads.push(injectionLibrary);
				}
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
	arg?: string | tg.Template | tg.File | tg.Symlink,
	buildToolchainArg?: std.env.Arg,
	buildArg?: string,
	hostArg?: string,
): Promise<wrap.Interpreter | undefined> => {
	// If the arg is undefined, a string or template, there is no interpreter.
	if (
		arg === undefined ||
		typeof arg === "string" ||
		arg instanceof tg.Template
	) {
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
			return interpreterFromElf(metadata, buildToolchainArg, buildArg, hostArg);
		}
		case "mach-o": {
			// Use default injection when no custom build, host, or buildToolchain is provided.
			if (
				buildArg === undefined &&
				hostArg === undefined &&
				buildToolchainArg === undefined
			) {
				const injectionDylib = await tg.build(injection.defaultInjection);
				return {
					kind: "dyld",
					libraryPaths: undefined,
					preloads: [injectionDylib],
				};
			} else {
				const arch = std.triple.arch(await std.triple.host());
				const host = hostArg ?? std.triple.create({ os: "darwin", arch });
				const buildTriple = buildArg ?? host;
				const buildToolchain = await getBuildToolchain(
					buildToolchainArg,
					buildTriple,
					host,
				);
				const injectionDylib = await tg.build(injection.injection, {
					buildToolchain,
					build: buildTriple,
					host,
				});
				return {
					kind: "dyld",
					libraryPaths: undefined,
					preloads: [injectionDylib],
				};
			}
		}
		case "shebang": {
			if (metadata.interpreter === undefined) {
				const host = hostArg ?? (await std.triple.host());
				const buildTriple = buildArg ?? host;
				return interpreterFromArg(
					await wrap.defaultShell({
						buildToolchain: buildToolchainArg,
						build: buildTriple,
						host,
					}),
					buildToolchainArg,
					buildArg,
					hostArg,
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
	buildToolchainArg?: std.env.Arg,
	buildArg?: string,
	hostArg?: string,
): Promise<wrap.Interpreter | undefined> => {
	// If there is no interpreter, this is a statically-linked executable. Nothing to do.
	if (metadata.interpreter === undefined) {
		return undefined;
	}

	const libc = metadata.interpreter?.includes("ld-linux") ? "gnu" : "musl";

	let host =
		hostArg ??
		std.triple.create({
			os: "linux",
			vendor: "unknown",
			arch: metadata.arch,
			environment: libc,
		});
	const buildTriple = buildArg ?? host;

	// If the interpreter is ld-linux, use the host toolchain. Otherwise, use the bootstrap toolchain.
	const buildToolchain = buildToolchainArg
		? buildToolchainArg
		: libc === "musl"
			? bootstrap.sdk.env(host)
			: await std.env.arg(
					await tg.build(gnu.toolchain, { host: buildTriple, target: host }),
					{
						utils: false,
					},
				);

	// Obtain injection library.
	const injectionLib = await tg.build(injection.injection, {
		buildToolchain,
		build: buildTriple,
		host,
	});

	// Handle each interpreter type.
	if (metadata.interpreter?.includes("ld-linux")) {
		// Handle an ld-linux interpreter. Reuse buildToolchain for toolchain components.
		const { ldso, libDir } = await std.sdk.toolchainComponents({
			env: await std.env.arg(buildToolchain, { utils: false }),
			host: buildTriple,
			target: host,
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
	executable?: string | tg.Template | tg.File | tg.Symlink | undefined;
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
	let neededLibraries = executable
		? await getInitialNeededLibraries(executable)
		: new Map();

	// Produce a set of the available library paths as directories with optional subpaths.
	const libraryPathSet = await createLibraryPathSet(paths);

	// Find any transitively needed libraries in the set and record their location.
	neededLibraries = executable
		? await findTransitiveNeededLibraries(
				executable,
				libraryPathSet,
				neededLibraries,
			)
		: new Map();

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
				const subpath = await path.path();
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
	const components = t.components;
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
	if (executable.kind === "address") {
		return;
	}
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

type BuildAndHostArg = {
	build?: string;
	host?: string;
};

/** Basic program for testing the wrapper code. */
export const argAndEnvDump = async (arg?: BuildAndHostArg) => {
	const host = arg?.host ?? (await std.triple.host());
	const build = arg?.build ?? host;

	const isCross = build !== host;
	const buildToolchain = isCross
		? gnu.toolchain({ host: build, target: host })
		: bootstrap.sdk(await bootstrap.toolchainTriple(host));

	const sdkEnv = await std.env.arg(
		buildToolchain,
		{
			TGLD_TRACING: "tgld=trace",
			TANGRAM_WRAPPER_TRACING: "tangram_wrapper=trace",
		},
		{ utils: false },
	);
	const targetPrefix = isCross ? `${host}-` : "";
	return await std.build`${targetPrefix}cc -xc ${inspectProcessSource} -o $OUTPUT`
		.bootstrap(true)
		.env(sdkEnv)
		.then(tg.File.expect);
};

export const argAndEnvDumpCross = () =>
	argAndEnvDump({
		build: "aarch64-unknown-linux-gnu",
		host: "x86_64-unknown-linux-gnu",
	});

export const test = async () => {
	await Promise.all([
		testSingleArgObjectNoMutations(),
		testDependencies(),
		testDylibPath(),
		testContentExecutable(),
		testContentExecutableVariadic(),
		testInterpreterSwappingNormal(),
		testInterpreterWrappingPreloads(),
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
			text.includes(`/proc/self/exe: /.tangram/artifacts/${wrapperID}`),
			"Expected /proc/self/exe to be set to the artifact ID of the wrapper",
		);
		tg.assert(
			text.includes(`argv[0]: /.tangram/artifacts/${wrapperID}`),
			"Expected argv[0] to be set to the wrapper that was invoked",
		);
	} else if (os === "darwin") {
		tg.assert(origManifestExecutable.kind === "path");
		const origExecutable = await wrap
			.executableFromManifestExecutable(origManifestExecutable)
			.then(tg.File.expect);
		await origExecutable.store();
		const origExecutableId = origExecutable.id;
		console.log("origExecutable", origExecutableId);
		tg.assert(
			text.match(
				new RegExp(`_NSGetExecutablePath: .*\\.tangram/artifacts/${wrapperID}`),
			),
			"Expected _NSGetExecutablePath to point to the wrapper",
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

export const testBasicCross = async () => {
	const detectedBuild = await std.triple.host();
	const detectedOs = std.triple.os(detectedBuild);
	if (detectedOs === "darwin") {
		throw new Error(`Cross-compilation is not supported on Darwin`);
	}
	const detectedArch = std.triple.arch(detectedBuild);
	const crossArch = detectedArch === "x86_64" ? "aarch64" : "x86_64";
	const crossHost = std.sdk.canonicalTriple(
		std.triple.create(detectedBuild, { arch: crossArch }),
	);

	const executable = await argAndEnvDump({
		build: detectedBuild,
		host: crossHost,
	});
	await executable.store();
	const executableID = executable.id;
	// The program is a wrapper produced by the LD proxy.
	console.log("argAndEnvDump wrapper ID", executableID);

	const wrapper = await wrap(executable, {
		args: ["--arg1", "--arg2"],
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
	tg.assert(manifest.interpreter);

	// Assert the wrapper was built for the cross host.
	const wrapperMetadata = await std.file.executableMetadata(wrapper);
	std.assert.assertJsonSnapshot(
		wrapperMetadata,
		`
		{
			"format": "elf",
			"arch": "${crossArch}"
		}
	`,
	);

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
					transitiveDependencyId: { item: transitiveDependency, options: {} },
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
	const bootstrapSdk = bootstrap.sdk(host);

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

export const testInterpreterSwappingNormal = async () => {
	const buildToolchain = await bootstrap.sdk(await std.triple.host());

	// Create a simple bash interpreter wrapper for testing
	const bashExecutable = await std.utils.bash
		.build({ bootstrap: true, env: buildToolchain })
		.then((artifact) => artifact.get("bin/bash"))
		.then(tg.File.expect);

	const firstInterpreter = await wrap(bashExecutable, {
		buildToolchain,
		args: ["-c", "echo 'first interpreter'"],
	});

	const secondInterpreter = await wrap(bashExecutable, {
		buildToolchain,
		args: ["-c", "echo 'second interpreter'"],
	});

	const script = "echo hi";

	// First, create a wrapper with the first interpreter
	const firstWrapper = await wrap(script, {
		buildToolchain,
		interpreter: firstInterpreter,
	});
	await firstWrapper.store();

	// Read the manifest to verify the first interpreter
	const firstManifest = await wrap.Manifest.read(firstWrapper);
	tg.assert(firstManifest);
	tg.assert(firstManifest.interpreter);
	tg.assert(firstManifest.interpreter.kind === "normal");

	// Now wrap the wrapper again with a different interpreter
	const secondWrapper = await wrap(firstWrapper, {
		buildToolchain,
		interpreter: secondInterpreter,
	});
	await secondWrapper.store();

	// Read the manifest to verify the interpreter was swapped
	const secondManifest = await wrap.Manifest.read(secondWrapper);
	tg.assert(secondManifest);
	tg.assert(secondManifest.interpreter);
	tg.assert(secondManifest.interpreter.kind === "normal");

	// The interpreters should be different
	const firstInterpreterTemplate = firstManifest.interpreter.path;
	const secondInterpreterTemplate = secondManifest.interpreter.path;

	tg.assert(
		JSON.stringify(firstInterpreterTemplate) !==
			JSON.stringify(secondInterpreterTemplate),
		"Expected interpreter to be swapped to the new value",
	);

	// The executable should still be the original executable, not the first wrapper
	tg.assert(
		JSON.stringify(secondManifest.executable) ===
			JSON.stringify(firstManifest.executable),
		"Expected executable to remain the same as the original",
	);

	return secondWrapper;
};

export const testInterpreterWrappingPreloads = async () => {
	const host = await std.triple.host();
	const os = std.triple.os(host);
	const expectedKind = os === "darwin" ? "dyld" : "ld-musl";

	const bootstrapSdk = await bootstrap.sdk(host);

	const testSource = tg.file(`
    #include <stdio.h>
    int main() {
      printf("Hello from test executable\\n");
      return 0;
    }
  `);

	const testExecutable = await std.build`cc -xc -o $OUTPUT ${testSource}`
		.bootstrap(true)
		.env(bootstrapSdk)
		.then(tg.File.expect);

	// Create a simple shared library that can be used as a preload.
	const preloadSource = tg.file(`
    #include <stdio.h>
    void __attribute__((constructor)) init() {
      fprintf(stderr, "Custom preload loaded\\n");
    }
  `);

	const customPreloadLib =
		await std.build`cc -shared -fPIC -xc -o $OUTPUT ${preloadSource}`
			.bootstrap(true)
			.env(bootstrapSdk)
			.then(tg.File.expect);

	// First, create a wrapper with the default interpreter (will have injection preload)
	const originalWrapper = await wrap(testExecutable, {
		buildToolchain: bootstrapSdk,
	});
	await originalWrapper.store();

	// Verify it has an ld-linux interpreter with preloads
	const originalManifest = await wrap.Manifest.read(originalWrapper);
	tg.assert(originalManifest);
	tg.assert(originalManifest.interpreter);
	tg.assert(originalManifest.interpreter.kind === expectedKind);
	tg.assert(originalManifest.interpreter.preloads);
	const originalPreloadCount = originalManifest.interpreter.preloads.length;
	tg.assert(
		originalPreloadCount >= 1,
		"Expected at least one default preload (injection library)",
	);

	// Test adding preloads to an existing wrapper using the top-level preloads field
	const extendedWrapper = await wrap(originalWrapper, {
		preloads: [customPreloadLib],
	});
	await extendedWrapper.store();

	// Read the extended manifest
	const extendedManifest = await wrap.Manifest.read(extendedWrapper);
	tg.assert(extendedManifest);
	tg.assert(extendedManifest.interpreter);
	tg.assert(extendedManifest.interpreter.kind === expectedKind);
	tg.assert(extendedManifest.interpreter.preloads);

	// Verify that we have both the original preloads AND the new one,.
	tg.assert(
		extendedManifest.interpreter.preloads.length === originalPreloadCount + 1,
		`Expected ${originalPreloadCount + 1} preloads (${originalPreloadCount} original + 1 new), but got ${extendedManifest.interpreter.preloads.length}`,
	);

	// Verify that the executable in the extended wrapper is still the original.
	tg.assert(
		JSON.stringify(extendedManifest.executable) ===
			JSON.stringify(originalManifest.executable),
		"Expected the executable to remain the same through re-wrapping",
	);

	// Verify that all original preloads are still present in the extended wrapper.
	const originalPreloadTemplates = originalManifest.interpreter.preloads;
	const extendedPreloadTemplates = extendedManifest.interpreter.preloads;

	let foundOriginalPreloads = 0;
	for (const originalPreload of originalPreloadTemplates) {
		const found = extendedPreloadTemplates.some(
			(extendedPreload) =>
				JSON.stringify(originalPreload) === JSON.stringify(extendedPreload),
		);
		if (found) {
			foundOriginalPreloads++;
		}
	}

	tg.assert(
		foundOriginalPreloads === originalPreloadTemplates.length,
		`Expected all ${originalPreloadTemplates.length} original preloads to be preserved, but only found ${foundOriginalPreloads}`,
	);

	// Verify that the custom preload was added.
	const customPreloadTemplate = await manifestTemplateFromArg(customPreloadLib);
	const foundCustomPreload = extendedPreloadTemplates.some(
		(extendedPreload) =>
			JSON.stringify(extendedPreload) === JSON.stringify(customPreloadTemplate),
	);
	tg.assert(foundCustomPreload, "Expected the custom preload to be added");

	return extendedWrapper;
};
