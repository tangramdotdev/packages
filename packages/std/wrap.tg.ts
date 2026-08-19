import * as bootstrap from "./bootstrap.tg.ts";
import * as elf from "./file/elf.tg.ts";
import * as gnu from "./sdk/gnu.tg.ts";
import * as std from "./tangram.ts";
import * as injection from "./wrap/injection.tg.ts";
import * as workspace from "./wrap/workspace.tg.ts";
import * as wrapperModule from "./wrap/wrapper.tg.ts";
import inspectProcessSource from "./wrap/test/inspectProcess.c" with { type: "file" };

export { ccProxy, ldProxy, wrapper } from "./wrap/workspace.tg.ts";

/** This module provides the `std.wrap()` function, which can be used to bundle an executable with a predefined environment and arguments, either of which may point to other Tangram artifacts.*/

// Retain authorized objects separately from the token-free manifest.
export type ManifestReferences = Map<tg.Object.Id, tg.Object>;

/** Wrap an executable. */
export async function wrap(...args: tg.Args<wrap.Arg>): Promise<tg.File> {
	const references: ManifestReferences = new Map();
	const arg = await wrap.argWithReferences(references, ...args);
	tg.assert(
		arg.executable !== undefined && arg.executable !== null,
		"No executable was provided.",
	);

	// Check if the executable is already a wrapper and get its manifest.
	// Only ELF and Mach-O binaries can have embedded manifests.
	let detectedManifest = undefined;
	let binary = undefined;
	if (
		arg.executable instanceof tg.File ||
		arg.executable instanceof tg.Symlink
	) {
		const f =
			arg.executable instanceof tg.Symlink
				? await arg.executable.resolve()
				: arg.executable;
		if (f instanceof tg.File) {
			const kind = await std.file.detectExecutableKind(f);
			if (kind === "elf" || kind === "mach-o") {
				detectedManifest = await wrap.Manifest.tryRead(f);
				if (detectedManifest !== undefined) {
					for (const dependency of manifestDependencies(detectedManifest)) {
						inheritManifestReference(dependency, references, f.state.tokens);
					}
				}
				if (arg.merge && detectedManifest && kind === "elf") {
					binary = f;
				}
			}
		}
	}
	const existingManifest = existingManifestForWrap(arg.merge, detectedManifest);

	const executable =
		existingManifest?.executable ??
		(await manifestExecutableFromArg(arg.executable, references));
	const host = arg.host ?? std.triple.host();
	std.triple.assert(host);

	const buildTriple = arg.build ?? host;
	std.triple.assert(buildTriple);

	// Construct the interpreter.
	// Cases:
	// - the user provided an interpreter argument.
	// - the user passed `null`, suppressing detection.
	// - the interpreter argument is incomplete, and we need to infer the interpreter.
	// - there was an interpreter in the original manifest.
	// - there is no interpreter arg and no original manifest.
	const interpreterSuppressed = arg.interpreter === null;
	let manifestInterpreter = undefined;
	if (arg.interpreter) {
		manifestInterpreter = await manifestInterpreterFromWrapArgObject(
			{
				...(arg.buildToolchain !== undefined
					? { buildToolchain: arg.buildToolchain }
					: {}),
				build: buildTriple,
				host,
				interpreter: arg.interpreter,
				...std.args.optional("libraryPaths", arg.libraryPaths),
				...(arg.libraryPathStrategy !== undefined &&
				arg.libraryPathStrategy !== null
					? { libraryPathStrategy: arg.libraryPathStrategy }
					: {}),
				...std.args.optional("preloads", arg.preloads),
			},
			references,
		);
	} else if (!interpreterSuppressed && existingManifest?.interpreter) {
		manifestInterpreter = existingManifest?.interpreter;
	} else if (
		!interpreterSuppressed &&
		arg.executable &&
		typeof arg.executable !== "number"
	) {
		manifestInterpreter = await manifestInterpreterFromWrapArgObject(
			{
				...(arg.buildToolchain !== undefined
					? { buildToolchain: arg.buildToolchain }
					: {}),
				build: buildTriple,
				host,
				executable: arg.executable,
				...std.args.optional("libraryPaths", arg.libraryPaths),
				...(arg.libraryPathStrategy !== undefined &&
				arg.libraryPathStrategy !== null
					? { libraryPathStrategy: arg.libraryPathStrategy }
					: {}),
				...std.args.optional("preloads", arg.preloads),
			},
			references,
		);
	}

	// Use existing manifest values as defaults if we're wrapping a wrapper
	const manifestEnv = await wrap.manifestEnvFromEnvObject(
		arg.env as std.env.EnvObject,
		references,
	);
	const manifestArgs = await Promise.all(
		(arg.args ?? []).map((arg) => manifestTemplateFromArg(arg, references)),
	);

	const manifestEnvValue =
		existingManifest?.env &&
		manifestEnv &&
		Object.keys(manifestEnv).length === 0
			? existingManifest.env
			: manifestEnv;
	const manifest: wrap.Manifest = {
		...(manifestInterpreter !== undefined
			? { interpreter: manifestInterpreter }
			: {}),
		executable,
		...(manifestEnvValue !== undefined ? { env: manifestEnvValue } : {}),
		args:
			manifestArgs.length === 0 && existingManifest?.args
				? existingManifest.args
				: manifestArgs,
	};

	// Get the wrapper executable.
	const detectedOs = std.triple.os(buildTriple);
	const build =
		detectedOs === "linux"
			? bootstrap.toolchainTriple(buildTriple)
			: buildTriple;

	// If there's an existing binary, use it.
	if (binary) {
		return wrap.Manifest.write(binary, manifest, references);
	} else {
		// We can't wrap a non-existent binary with a manifest specifying an address.
		if (manifest.executable.kind === "address") {
			throw new Error("invalid manifest");
		}
		// Use tg.build for the wrapper so the call is deduplicated across
		// concurrent wrap() invocations and can cache-hit from a remote.
		const wrapper = await tg
			.build(workspace.wrapper, { build, host })
			.named("default wrapper");
		return wrap.Manifest.write(wrapper, manifest, references);
	}
}

export default wrap;

export namespace wrap {
	export type Arg = string | tg.Template | tg.File | tg.Symlink | ArgObject;

	export type ArgObject = {
		/** Command line arguments to bind to the wrapper. If the executable is wrapped, they will be merged. */
		args?: Array<tg.Template.Arg> | null;

		/** The machine to build the wrapper on. */
		build?: string | null;

		/** The build toolchain to use to produce components. Will use the default for the system if not provided. */
		buildToolchain?: std.env.Arg | null;

		/** Environment variables to bind to the wrapper. If the executable is wrapped, they will be merged. */
		env?: std.env.Arg | null;

		/** The executable to wrap. */
		executable?: string | tg.Template | tg.File | tg.Symlink | number | null;

		/** The host system to produce a wrapper for. */
		host?: string | null;

		/** The interpreter to run the executable with. If not provided, a default is detected. Pass `null` to suppress detection and invoke the executable directly. */
		interpreter?: tg.File | tg.Symlink | tg.Template | Interpreter | null;

		/** Library paths to include. If the executable is wrapped, they will be merged. */
		libraryPaths?: Array<tg.Directory | tg.Symlink | tg.Template> | null;

		/** Which library path strategy should we use? The default is "unfilteredIsolate", which separates libraries into individual directories. */
		libraryPathStrategy?: LibraryPathStrategy | null;

		/** Preloads to include. If the executable is wrapped, they will be merged. */
		preloads?: Array<tg.File | tg.Symlink | tg.Template> | null;

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
		args?: Array<tg.Template.Arg>;
	};

	export type LdLinuxInterpreter = {
		kind: "ld-linux";

		/** The ld-linux file. */
		executable: tg.File | tg.Symlink;

		/** Additional library paths to include. */
		libraryPaths?: Array<tg.Template.Arg>;

		/** Additional preloads to load. */
		preloads?: Array<tg.Template.Arg>;

		/** Additional arguments to pass to the interpreter. */
		args?: Array<tg.Template.Arg>;
	};

	export type LdMuslInterpreter = {
		kind: "ld-musl";

		/** The ld-musl file. */
		executable: tg.File | tg.Symlink;

		/** Additional library paths to include. */
		libraryPaths?: Array<tg.Template.Arg>;

		/** Additional preloads to load. */
		preloads?: Array<tg.Template.Arg>;

		/** Additional arguments to pass to the interpreter. */
		args?: Array<tg.Template.Arg>;
	};

	export type DyLdInterpreter = {
		kind: "dyld";

		/** Additional library paths to include. */
		libraryPaths?: Array<tg.Template.Arg>;

		/** Additional preloads to load. */
		preloads?: Array<tg.Template.Arg>;
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
		interpreter?: Manifest.Interpreter;
		executable: Manifest.Executable;
		env?: Manifest.Mutation;
		args?: Array<Manifest.Template>;
	};

	/** Process variadic arguments. */
	export async function arg(
		...args: tg.Args<wrap.Arg>
	): Promise<wrap.ArgObject> {
		return argWithReferences(new Map(), ...args);
	}

	/** @internal Process variadic arguments while retaining authorized manifest references. */
	export async function argWithReferences(
		references: ManifestReferences,
		...args: tg.Args<wrap.Arg>
	): Promise<wrap.ArgObject> {
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
		} = await tg.Args.apply<wrap.Arg, wrap.ArgObject, wrap.ArgObject>({
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
					return { ...arg };
				} else {
					return tg.unreachable(`Unsupported argument: ${arg}`);
				}
			},
			reduce: {
				env: (a, b) => std.env.compose(a ?? null, b ?? null),
				libraryPaths: "append",
				preloads: "append",
				args: "append",
			},
		});

		tg.assert(executable !== undefined && executable !== null);

		// Determine the host. If it was not provided, detect the executable host if it's a file, and fall back to the detected host.
		const detectedHost = std.triple.host();
		let host = host_;
		if (host === undefined || host === null) {
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
		const tokens = tg.Artifact.is(executable) ? executable.state.tokens : {};

		// Determine whether to try to merge this wrapper with an existing one. If the user specified `true`, only honor if an existing manifest was found.
		const merge = merge_ && existingManifest !== undefined;

		const envs: tg.Args<std.env.Arg> = [];

		// If the executable is a file and the behavior is merge, try to read the manifest from it.
		if (merge) {
			if (existingManifest === undefined) {
				const dbg = tg.Artifact.is(executable) ? executable.id : executable;
				throw new Error(
					`Could not locate existing manifest to merge with.  Received ${dbg}.`,
				);
			}

			envs.push(
				await wrap.envObjectFromManifestEnv(
					existingManifest.env,
					references,
					tokens,
				),
			);

			// Merge the existing interpreter with any new interpreter provided
			const existingInterpreter = await wrap.interpreterFromManifestInterpreter(
				existingManifest.interpreter,
				references,
				tokens,
			);
			if (interpreter !== undefined && interpreter !== null) {
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
			} else if (interpreter === undefined) {
				interpreter = existingInterpreter;
			}

			// TODO: figure this API out a little better.
			if (existingManifest.executable.kind !== "address") {
				executable = await wrap.executableFromManifestExecutable(
					existingManifest.executable,
					references,
					tokens,
				);
			}

			const existingArgs = await Promise.all(
				(existingManifest.args ?? []).map((arg) =>
					templateFromManifestTemplate(arg, references, tokens),
				),
			);
			args_ = mergeWrapArgs(args_ ?? [], existingArgs);
		}

		const env = await std.env.compose(...envs, env_);

		// If the executable is a content executable, make sure there is a normal interpreter for it.
		if (executable instanceof tg.Template || typeof executable === "string") {
			if (interpreter === undefined) {
				interpreter = await wrap.defaultShell({
					...(buildToolchain !== undefined ? { buildToolchain } : {}),
					build,
					host,
				});
			}
		}

		const output = {
			args: args_,
			build,
			...(buildToolchain !== undefined ? { buildToolchain } : {}),
			env,
			executable,
			host,
			...(interpreter !== undefined ? { interpreter } : {}),
			merge,
			libraryPaths,
			...(libraryPathStrategy !== undefined ? { libraryPathStrategy } : {}),
			preloads,
		};

		return output;
	}

	export type DefaultShellArg = {
		/** The toolchain to use to build constituent components. Default: `std.sdk()`. */
		buildToolchain?: std.env.Arg;
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
	export async function defaultShell(arg?: DefaultShellArg) {
		const {
			buildToolchain: buildToolchain_,
			build: build_,
			disallowUnset = true,
			exitOnErr = true,
			includeUtils = true,
			host: host_,
			pipefail = true,
		} = arg ?? {};

		const host = host_ ?? std.triple.host();
		const build = build_ ?? host;

		// Provide bash for the detected host system. The toolchain is always explicit here, so the build adds no SDK of its own.
		let buildArg: {
			build: string;
			host: string;
			env?: tg.Unresolved<std.env.Arg>;
			sdk?: std.sdk.Arg;
		} = { build, host };
		if (buildToolchain_) {
			buildArg = { ...buildArg, env: buildToolchain_, sdk: "none" };
		} else {
			buildArg = {
				...buildArg,
				env: await tg.build(std.sdk).named("sdk"), // FIXME - common export.
				sdk: "none",
			};
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
	}

	export async function envObjectFromManifestEnv(
		mutation?: wrap.Manifest.Mutation,
		references?: ManifestReferences,
		tokens?: tg.Authorization.Tokens,
	): Promise<std.env.EnvObject> {
		if (mutation === undefined || mutation.kind === "unset") {
			return {};
		}
		tg.assert(
			mutation.kind === "set",
			"malformed env, expected a set or unset mutation",
		);
		return envObjectFromMapValue(mutation.value, references, tokens);
	}

	export async function interpreterFromManifestInterpreter(
		manifestInterpreter?: wrap.Manifest.Interpreter,
		references?: ManifestReferences,
		tokens?: tg.Authorization.Tokens,
	): Promise<wrap.Interpreter | undefined> {
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
						references,
						tokens,
					),
					...(manifestInterpreter.args === undefined
						? {}
						: {
								args: await Promise.all(
									manifestInterpreter.args.map((arg) =>
										templateFromManifestTemplate(arg, references, tokens),
									),
								),
							}),
				};
			}
			case "ld-linux":
			case "ld-musl": {
				return {
					kind,
					executable: await fileOrSymlinkFromManifestTemplate(
						manifestInterpreter.path,
						references,
						tokens,
					),
					...(manifestInterpreter.libraryPaths === undefined
						? {}
						: {
								libraryPaths: await Promise.all(
									manifestInterpreter.libraryPaths.map((arg) =>
										templateFromManifestTemplate(arg, references, tokens),
									),
								),
							}),
					...(manifestInterpreter.preloads === undefined
						? {}
						: {
								preloads: await Promise.all(
									manifestInterpreter.preloads.map((arg) =>
										fileOrSymlinkFromManifestTemplate(arg, references, tokens),
									),
								),
							}),
					...(manifestInterpreter.args === undefined
						? {}
						: {
								args: await Promise.all(
									manifestInterpreter.args.map((arg) =>
										templateFromManifestTemplate(arg, references, tokens),
									),
								),
							}),
				};
			}
			case "dyld": {
				return {
					kind,
					...(manifestInterpreter.libraryPaths === undefined
						? {}
						: {
								libraryPaths: await Promise.all(
									manifestInterpreter.libraryPaths.map((arg) =>
										templateFromManifestTemplate(arg, references, tokens),
									),
								),
							}),
					...(manifestInterpreter.preloads === undefined
						? {}
						: {
								preloads: await Promise.all(
									manifestInterpreter.preloads.map((arg) =>
										fileOrSymlinkFromManifestTemplate(arg, references, tokens),
									),
								),
							}),
				};
			}
			default: {
				return tg.unreachable(`Unexpected interpreter ${manifestInterpreter}`);
			}
		}
	}

	/** Utility to retrieve the existing manifest from an executable arg, if it is a wrapper. If not, returns `undefined`. Only ELF and Mach-O binaries can have embedded manifests. */
	export async function existingManifestFromExecutableArg(
		executable:
			| undefined
			| number
			| string
			| tg.Template
			| tg.File
			| tg.Symlink,
	): Promise<wrap.Manifest | undefined> {
		let ret = undefined;
		if (executable instanceof tg.File || executable instanceof tg.Symlink) {
			const f =
				executable instanceof tg.Symlink
					? await executable.resolve()
					: executable;
			if (f instanceof tg.File) {
				const kind = await std.file.detectExecutableKind(f);
				if (kind === "elf" || kind === "mach-o") {
					const manifest = await wrap.Manifest.tryRead(f);
					if (manifest) {
						ret = manifest;
					}
				}
			}
		}
		return ret;
	}

	/** Merge two interpreters, with the new interpreter's properties taking precedence but arrays being concatenated. */
	export async function mergeInterpreters(
		existingInterpreter?: wrap.Interpreter,
		newInterpreter?: wrap.Interpreter,
	): Promise<wrap.Interpreter | undefined> {
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
				// Concatenate args arrays.
				const args = [...(existing.args ?? []), ...(new_.args ?? [])];
				return {
					kind,
					// New executable takes precedence.
					executable: new_.executable ?? existing.executable,
					...(args.length > 0 ? { args } : {}),
				};
			}
			case "ld-linux":
			case "ld-musl": {
				const existing = existingInterpreter as
					| wrap.LdLinuxInterpreter
					| wrap.LdMuslInterpreter;
				const new_ = newInterpreter as
					| wrap.LdLinuxInterpreter
					| wrap.LdMuslInterpreter;
				// Concatenate libraryPaths, preloads, and args arrays.
				const libraryPaths = [
					...(existing.libraryPaths ?? []),
					...(new_.libraryPaths ?? []),
				];
				const preloads = [
					...(existing.preloads ?? []),
					...(new_.preloads ?? []),
				];
				const args = [...(existing.args ?? []), ...(new_.args ?? [])];
				return {
					kind,
					// New executable takes precedence.
					executable: new_.executable ?? existing.executable,
					...(libraryPaths.length > 0 ? { libraryPaths } : {}),
					...(preloads.length > 0 ? { preloads } : {}),
					...(args.length > 0 ? { args } : {}),
				};
			}
			case "dyld": {
				const existing = existingInterpreter as wrap.DyLdInterpreter;
				const new_ = newInterpreter as wrap.DyLdInterpreter;
				// Concatenate libraryPaths and preloads arrays.
				const libraryPaths = [
					...(existing.libraryPaths ?? []),
					...(new_.libraryPaths ?? []),
				];
				const preloads = [
					...(existing.preloads ?? []),
					...(new_.preloads ?? []),
				];
				return {
					kind,
					...(libraryPaths.length > 0 ? { libraryPaths } : {}),
					...(preloads.length > 0 ? { preloads } : {}),
				};
			}
			default: {
				return tg.unreachable(`Unexpected interpreter kind ${kind}`);
			}
		}
	}

	export async function executableFromManifestExecutable(
		manifestExecutable: wrap.Manifest.Executable,
		references?: ManifestReferences,
		tokens?: tg.Authorization.Tokens,
	): Promise<number | tg.Template | tg.File | tg.Symlink> {
		if (manifestExecutable.kind === "content") {
			return templateFromManifestTemplate(
				manifestExecutable.value,
				references,
				tokens,
			);
		} else if (manifestExecutable.kind === "path") {
			return fileOrSymlinkFromManifestTemplate(
				manifestExecutable.value,
				references,
				tokens,
			);
		} else {
			return manifestExecutable.value;
		}
	}

	export async function manifestEnvFromEnvObject(
		envObject: std.env.EnvObject,
		references?: ManifestReferences,
	): Promise<wrap.Manifest.Mutation | undefined> {
		const value = await manifestValueFromValue(envObject, references);
		tg.assert(
			!Array.isArray(value),
			`Expected a single value, but got an array: ${value}`,
		);
		if (value === null) {
			return undefined;
		}
		tg.assert(
			typeof value === "object" && "kind" in value && value.kind === "map",
			`Expected a map, but got ${value}.`,
		);
		return { kind: "set", value };
	}

	/** Attempt to obtain the needed libraries of the wrapped exectuable of a wrapper. */
	export async function tryNeededLibraries(
		file: tg.File,
	): Promise<Array<string> | undefined> {
		try {
			return await neededLibraries(file);
		} catch (_) {
			return undefined;
		}
	}

	/** Obtain the needed libraries of the wrapped executable of a wrapper. */
	export async function neededLibraries(file: tg.File): Promise<Array<string>> {
		// Only ELF and Mach-O binaries can have embedded manifests.
		const kind = await std.file.detectExecutableKind(file);
		if (kind !== "elf" && kind !== "mach-o") {
			await file.store();
			throw new Error(
				`Cannot determine needed libraries for ${file.id}: not a binary file (detected ${kind}).`,
			);
		}
		const manifest = await wrap.Manifest.tryRead(file);
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
			undefined,
			file.state.tokens,
		);
		tg.assert(
			wrappedExecutableFile instanceof tg.File,
			`executable must be a file, received ${wrappedExecutableFile.id}`,
		);
		return await getNeededLibraries(wrappedExecutableFile);
	}

	export namespace Manifest {
		export type Interpreter =
			| NormalInterpreter
			| LdLinuxInterpreter
			| LdMuslInterpreter
			| DyLdInterpreter;

		export type NormalInterpreter = {
			kind: "normal";
			path: Manifest.Template;
			args?: Array<Manifest.Template>;
		};

		export type LdLinuxInterpreter = {
			kind: "ld-linux";
			path: Manifest.Template;
			libraryPaths?: Array<Manifest.Template>;
			preloads?: Array<Manifest.Template>;
			args?: Array<Manifest.Template>;
		};

		export type LdMuslInterpreter = {
			kind: "ld-musl";
			path: Manifest.Template;
			libraryPaths?: Array<Manifest.Template>;
			preloads?: Array<Manifest.Template>;
			args?: Array<Manifest.Template>;
		};

		export type DyLdInterpreter = {
			kind: "dyld";
			libraryPaths?: Array<Manifest.Template>;
			preloads?: Array<Manifest.Template>;
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
				| { kind: "artifact"; value: tg.Artifact.Id }
				| { kind: "placeholder"; value: string };
		}

		// Matches tg::mutation::Data
		export type Mutation =
			| { kind: "unset" }
			| { kind: "set"; value: Manifest.Value }
			| { kind: "set_if_unset"; value: Manifest.Value }
			| {
					kind: "prefix";
					template: Manifest.Template;
					separator?: string;
			  }
			| {
					kind: "suffix";
					template: Manifest.Template;
					separator?: string;
			  }
			| { kind: "prepend"; values: Array<Manifest.Value> }
			| { kind: "append"; values: Array<Manifest.Value> }
			| {
					kind: "merge";
					value: { kind: "map"; value: { [key: string]: Manifest.Value } };
			  };

		// Matches tg::value::Data
		export type Value =
			| null
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

		export async function read(
			file: tg.File,
		): Promise<wrap.Manifest | undefined> {
			const manifestFile = await tg
				.build({
					executable: workspace.wrap({}),
					args: ["read", tg`${file}`, "-o", tg.output],
					env: { RUST_BACKTRACE: "full" },
				})
				.named("read manifest")
				.then(tg.File.expect);
			const manifestBytes = await manifestFile.bytes;
			const manifestString = tg.encoding.utf8.decode(manifestBytes);
			const output = tg.encoding.json.decode(
				manifestString,
			) as workspace.WrapOutput;

			return output.manifest;
		}

		export async function tryRead(
			file: tg.File,
		): Promise<wrap.Manifest | undefined> {
			try {
				return await read(file);
			} catch (_) {
				return undefined;
			}
		}

		/** Write a manifest to a file. */
		export async function write(
			file: tg.File,
			manifest: wrap.Manifest,
			references: ManifestReferences,
		) {
			// Validate the manifest references.
			await validateManifestReferences(manifest, references);

			// Serialize the manifest.
			const manifestBytes = tg.encoding.utf8.encode(
				tg.encoding.json.encode(manifest),
			);
			const manifestFile = tg.file(manifestBytes);

			// Create the file with the new manifest.
			let newFile = await tg
				.build({
					executable: workspace.wrap({}),
					args: [
						"write",
						tg`${file}`,
						"--manifest",
						tg`${manifestFile}`,
						"-o",
						tg.output,
					],
					env: { RUST_BACKTRACE: "full" },
				})
				.named("write manifest")
				.then(tg.File.expect);

			// Codesign the new file.
			if (await needsCodesign(newFile)) {
				newFile = await tg
					.build({
						executable: workspace.rcodesign(),
						args: ["sign", tg`${newFile}`, tg`${tg.output}`],
						env: { RUST_BACKTRACE: "full" },
					})
					.named("codesign")
					.then(tg.File.expect);
			}

			const fileDependencies = await file.dependencyObjects;
			await Promise.all(
				fileDependencies.map((reference) =>
					addManifestReference(references, reference),
				),
			);
			const dependencies: { [reference: string]: tg.Referent<tg.Object> } = {};
			for (const [id, node] of references) {
				dependencies[id] = { node, options: {} };
			}

			// Create the file.
			const fileWithDependencies = tg.file(newFile, {
				dependencies,
				executable: true,
			});
			return fileWithDependencies;
		}
	}
}

async function validateManifestReferences(
	manifest: wrap.Manifest,
	references: ManifestReferences,
): Promise<void> {
	for (const dependency of manifestDependencies(manifest)) {
		const reference = references.get(dependency.id);
		if (reference === undefined) {
			throw new Error(
				`missing an authorized manifest reference for ${dependency.id}`,
			);
		}
		await reference.store();
	}
}

async function addManifestReference(
	references: ManifestReferences,
	object: tg.Object,
): Promise<void> {
	await object.store();
	setManifestReference(references, object);
}

// Determine whether an object carries any authorization tokens.
function hasTokens(object: tg.Object): boolean {
	return Object.keys(object.state.tokens).length > 0;
}

function setManifestReference(
	references: ManifestReferences,
	object: tg.Object,
): void {
	const existing = references.get(object.id);
	if (existing === undefined || (!hasTokens(existing) && hasTokens(object))) {
		references.set(object.id, object);
	}
}

function inheritManifestReference<T extends tg.Object>(
	object: T,
	references?: ManifestReferences,
	tokens?: tg.Authorization.Tokens,
): T {
	tg.Object.inheritTokens(object, tokens ?? {});
	if (references !== undefined) {
		setManifestReference(references, object);
	}
	return object;
}

function existingManifestForWrap(
	merge: boolean | undefined,
	existingManifest: wrap.Manifest | undefined,
): wrap.Manifest | undefined {
	return merge ? existingManifest : undefined;
}

function mergeWrapArgs(
	newArgs: Array<tg.Template.Arg>,
	existingArgs: Array<tg.Template.Arg>,
): Array<tg.Template.Arg> {
	return existingArgs.concat(newArgs);
}

async function needsCodesign(file: tg.File): Promise<boolean> {
	const bytes = await file.read({ length: 4 });
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const magic = view.getUint32(0, false);
	const magicNumbers = [
		0xbfbafeca, 0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe,
	];
	return magicNumbers.includes(magic);
}

function isArgObject(arg: unknown): arg is wrap.ArgObject {
	return (
		typeof arg === "object" &&
		arg !== null &&
		!Array.isArray(arg) &&
		!tg.Object.is(arg) &&
		!(arg instanceof tg.Template)
	);
}

async function manifestExecutableFromArg(
	arg:
		| number
		| string
		| tg.Template
		| tg.File
		| tg.Symlink
		| wrap.Manifest.Executable,
	references?: ManifestReferences,
): Promise<wrap.Manifest.Executable> {
	if (typeof arg === "number") {
		return {
			kind: "address",
			value: arg,
		};
	} else if (isManifestExecutable(arg)) {
		return arg;
	} else if (arg instanceof tg.File || arg instanceof tg.Symlink) {
		const value = await manifestTemplateFromArg(arg, references);
		tg.assert(value);
		return {
			kind: "path",
			value,
		};
	} else if (typeof arg === "string" || arg instanceof tg.Template) {
		return {
			kind: "content",
			value: await manifestTemplateFromArg(arg, references),
		};
	} else {
		return tg.unreachable();
	}
}

function isManifestExecutable(arg: unknown): arg is wrap.Manifest.Executable {
	return (
		arg !== undefined &&
		arg !== null &&
		typeof arg === "object" &&
		"kind" in arg &&
		(arg.kind === "address" || arg.kind === "path" || arg.kind === "content")
	);
}

/** The subset of `wrap.ArgObject` relevant to producing a `wrap.Manifest.Interpreter`. */
type ManifestInterpreterArg = {
	buildToolchain?: std.env.Arg;
	build?: string;
	host?: string;
	interpreter?: tg.File | tg.Symlink | tg.Template | wrap.Interpreter;
	executable?: string | tg.Template | tg.File | tg.Symlink;
	libraryPaths?: Array<tg.Template.Arg>;
	libraryPathStrategy?: wrap.LibraryPathStrategy;
	preloads?: Array<tg.File | tg.Symlink | tg.Template>;
};

/** Compute the buildToolchain, using the provided value or computing a default. */
async function getBuildToolchain(
	buildToolchain: std.env.Arg | undefined,
	build: string,
	host: string,
): Promise<std.env.Arg> {
	if (buildToolchain !== undefined) {
		return buildToolchain;
	}
	return std.triple.os(host) === "linux"
		? await std.env.compose(
				await tg
					.build(gnu.toolchain, { host: build, target: host })
					.named("gnu toolchain"),
			)
		: await tg.build(std.buildBootstrapSdkEnv).named("bootstrap sdk env");
}

/** Produce the manifest interpreter object given a set of parameters. */
async function manifestInterpreterFromWrapArgObject(
	arg: ManifestInterpreterArg,
	references?: ManifestReferences,
): Promise<wrap.Manifest.Interpreter | undefined> {
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
			...(executable !== undefined ? { executable } : {}),
			interpreter,
			...(libraryPaths !== undefined ? { libraryPaths } : {}),
			...(libraryPathStrategy !== undefined ? { libraryPathStrategy } : {}),
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
		? manifestInterpreterFromWrapInterpreter(interpreter, references)
		: undefined;
}

/** Serialize an interpreter into its manifest form. */
async function manifestInterpreterFromWrapInterpreter(
	interpreter: wrap.Interpreter,
	references?: ManifestReferences,
): Promise<wrap.Manifest.Interpreter> {
	// Process each field present in the incoming object.
	const { kind } = interpreter;

	// Process all fields concurrently
	const [path, libraryPaths, preloads, args] = await Promise.all([
		// Only process executable if it exists
		"executable" in interpreter
			? manifestTemplateFromArg(interpreter.executable, references)
			: Promise.resolve(undefined),

		// Only process libraryPaths if it exists
		"libraryPaths" in interpreter && interpreter.libraryPaths !== undefined
			? Promise.all(
					interpreter.libraryPaths.map((arg) =>
						manifestTemplateFromArg(arg, references),
					),
				)
			: Promise.resolve(undefined),

		// Only process preloads if it exists
		"preloads" in interpreter && interpreter.preloads !== undefined
			? Promise.all(
					interpreter.preloads.map((arg) =>
						manifestTemplateFromArg(arg, references),
					),
				)
			: Promise.resolve(undefined),

		// Only process args if it exists
		"args" in interpreter && interpreter.args !== undefined
			? Promise.all(
					interpreter.args.map((arg) =>
						manifestTemplateFromArg(arg, references),
					),
				)
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
}

/** Given an interpreter arg, produce an interpreter object with all fields populated. */
async function interpreterFromArg(
	arg: tg.File | tg.Symlink | tg.Template | wrap.Interpreter,
	buildToolchainArg?: std.env.Arg,
	buildArg?: string,
	hostArg?: string,
): Promise<wrap.Interpreter> {
	const host = hostArg ?? std.triple.host();
	const buildTriple = buildArg ?? host;
	// If the arg is an executable, then wrap it and create a normal interpreter.
	if (
		arg instanceof tg.File ||
		arg instanceof tg.Symlink ||
		arg instanceof tg.Template
	) {
		const executable = await tg.build(std.wrap, {
			...std.args.optional("buildToolchain", buildToolchainArg),
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
		case "ld-linux":
		case "ld-musl": {
			const libraryPaths = arg.libraryPaths;
			const args = arg.args;
			const preloads = [...(arg.preloads ?? [])];

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
					`Cannot build an ${kind} interpreter for a non-ELF executable.`,
				);
			}

			// If no preload is defined, add the default injection preload.
			if (preloads.length === 0) {
				const arch = interpreterMetadata.arch;
				const host =
					kind === "ld-linux"
						? `${arch}-unknown-linux-gnu`
						: `${arch}-linux-musl`;
				const detectedBuild = std.triple.host();
				const build = buildArg ?? detectedBuild;
				const buildToolchain = await getBuildToolchain(
					buildToolchainArg,
					build,
					host,
				);
				const injectionLibrary = await tg
					.build(injection.injection, {
						...std.args.optional("buildToolchain", buildToolchain),
						build,
						host,
					})
					.named("injection");
				preloads.push(injectionLibrary);
			}

			return {
				kind,
				executable,
				...(libraryPaths !== undefined ? { libraryPaths } : {}),
				preloads,
				...(args !== undefined ? { args } : {}),
			};
		}
		case "dyld": {
			const libraryPaths = arg.libraryPaths;
			const preloads = [...(arg.preloads ?? [])];

			// If no preload is defined, add the default injection preload.
			if (preloads.length === 0) {
				const host = std.triple.host();
				// Use default injection when no custom build or buildToolchain is provided.
				if (buildArg === undefined && buildToolchainArg === undefined) {
					const injectionLibrary = await tg
						.build(std.buildDefaultInjection)
						.named("default injection");
					preloads.push(injectionLibrary);
				} else {
					const build = buildArg ?? host;
					const buildToolchain = await getBuildToolchain(
						buildToolchainArg,
						build,
						host,
					);
					const injectionLibrary = await tg
						.build(injection.injection, {
							...std.args.optional("buildToolchain", buildToolchain),
							build: buildArg ?? null,
							host,
						})
						.named("injection");
					preloads.push(injectionLibrary);
				}
			}

			return {
				kind,
				...(libraryPaths !== undefined ? { libraryPaths } : {}),
				preloads,
			};
		}
		case "normal": {
			return {
				kind,
				executable: arg.executable,
				...(arg.args !== undefined ? { args: arg.args } : {}),
			};
		}
		default: {
			return tg.unreachable(`unrecognized kind ${kind}`);
		}
	}
}

/** Inspect the executable and produce the corresponding interpreter. */
async function interpreterFromExecutableArg(
	arg?: string | tg.Template | tg.File | tg.Symlink,
	buildToolchainArg?: std.env.Arg,
	buildArg?: string,
	hostArg?: string,
): Promise<wrap.Interpreter | undefined> {
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
				const injectionDylib = await tg
					.build(std.buildDefaultInjection)
					.named("default injection");
				return {
					kind: "dyld",
					preloads: [injectionDylib],
				};
			} else {
				const arch = std.triple.arch(std.triple.host());
				const host = hostArg ?? std.triple.create({ os: "darwin", arch });
				const buildTriple = buildArg ?? host;
				const buildToolchain = await getBuildToolchain(
					buildToolchainArg,
					buildTriple,
					host,
				);
				const injectionDylib = await tg
					.build(injection.injection, {
						...std.args.optional("buildToolchain", buildToolchain),
						build: buildTriple,
						host,
					})
					.named("injection");
				return {
					kind: "dyld",
					preloads: [injectionDylib],
				};
			}
		}
		case "shebang": {
			if (metadata.interpreter === undefined) {
				const host = hostArg ?? std.triple.host();
				const buildTriple = buildArg ?? host;
				return interpreterFromArg(
					await wrap.defaultShell({
						...std.args.optional("buildToolchain", buildToolchainArg),
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
}

/** Inspect an ELF file and produce the correct interpreter. */
async function interpreterFromElf(
	metadata: std.file.ElfExecutableMetadata,
	buildToolchainArg?: std.env.Arg,
	buildArg?: string,
	hostArg?: string,
): Promise<wrap.Interpreter | undefined> {
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
			: await std.env.compose(
					await tg
						.build(gnu.toolchain, { host: buildTriple, target: host })
						.named("gnu toolchain"),
				);

	// Obtain injection library.
	const injectionLib = await tg
		.build(injection.injection, {
			buildToolchain,
			build: buildTriple,
			host,
		})
		.named("injection");

	// Handle each interpreter type.
	if (metadata.interpreter?.includes("ld-linux")) {
		// Handle an ld-linux interpreter. Reuse buildToolchain for toolchain components.
		const { ldso, libDir } = await std.sdk.toolchainComponents({
			env: await std.env.compose(buildToolchain),
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
		const { ldso, libDir } = await muslLoader(metadata.interpreter, host);
		return {
			kind: "ld-musl",
			executable: ldso,
			libraryPaths: [libDir],
			preloads: [injectionLib],
		};
	} else {
		throw new Error(`Unsupported interpreter: "${metadata.interpreter}".`);
	}
}

/** Locate the musl loader an executable asks for. Two musl builds are not interchangeable as loaders, so honor the one named in the interpreter path, falling back to the bootstrap musl when that path does not point into an artifact. */
async function muslLoader(
	interpreterPath: string,
	host: string,
): Promise<{ ldso: tg.File; libDir: tg.Directory }> {
	const match = interpreterPath.match(/\/(dir_[0-9a-z]+)\/(.*)\/([^/]+)$/);
	const [, directoryId, libSubpath, ldsoName] = match ?? [];
	if (directoryId !== undefined && libSubpath && ldsoName !== undefined) {
		const libDir = await tg.Directory.withId(directoryId)
			.get(libSubpath)
			.then(tg.Directory.expect);
		let ldso = await libDir.get(ldsoName);
		if (ldso instanceof tg.Symlink) {
			ldso = await ldso.resolve().then((resolved) => {
				tg.assert(resolved, `dangling musl loader symlink ${ldsoName}`);
				return resolved;
			});
		}
		return { ldso: tg.File.expect(ldso), libDir };
	}
	const muslArtifact = await bootstrap.musl.build({ host });
	const libDir = await muslArtifact.get("lib").then(tg.Directory.expect);
	const ldso = await libDir.get("libc.so").then(tg.File.expect);
	return { ldso, libDir };
}

type OptimizeLibraryPathsArg = {
	executable?: string | tg.Template | tg.File | tg.Symlink;
	interpreter:
		| wrap.DyLdInterpreter
		| wrap.LdLinuxInterpreter
		| wrap.LdMuslInterpreter;
	libraryPaths?: Array<tg.Template.Arg>;
	libraryPathStrategy?: wrap.LibraryPathStrategy;
};

async function optimizeLibraryPaths(
	arg: OptimizeLibraryPathsArg,
): Promise<
	wrap.DyLdInterpreter | wrap.LdLinuxInterpreter | wrap.LdMuslInterpreter
> {
	const {
		interpreter,
		libraryPaths: additionalLibraryPaths = [],
		libraryPathStrategy: strategy = "unfilteredIsolate",
	} = arg;

	let executable = arg.executable;

	// Set up the initial set of paths.
	const paths = [
		...(interpreter.libraryPaths ?? []),
		...additionalLibraryPaths,
	];
	const output = { ...interpreter, libraryPaths: paths };

	if (strategy === "none") {
		return output;
	}

	// If we're using the default strategy, optimize the paths and return before analyzing the executable.
	if (strategy === "unfilteredIsolate") {
		output.libraryPaths = await separateLibraries(paths);
		return output;
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

	// Produce a set of the available library paths as directories with optional subpaths.
	const libraryPathSet = await createLibraryPathSet(paths);

	// Find any transitively needed libraries in the set and record their location.
	const neededLibraries = executable
		? await findTransitiveNeededLibraries(executable, libraryPathSet)
		: new Map();

	// All optimization strategies required filtering first.
	const filteredNeededLibraries: Map<string, DirWithSubpath> = new Map();
	neededLibraries.forEach((referent, name) => {
		if (referent !== undefined) {
			filteredNeededLibraries.set(name, referent);
		}
	});
	const filteredLibraryPathSet = new Set(filteredNeededLibraries.values());
	if (strategy === "filter") {
		output.libraryPaths = await Promise.all(
			[...filteredLibraryPathSet].map(templateArgFromDirWithSubpath),
		);
		return output;
	}

	switch (strategy) {
		case "resolve": {
			output.libraryPaths = await resolvePaths(filteredLibraryPathSet);
			break;
		}
		case "isolate": {
			const isolatedPaths: Array<tg.Directory> = [];
			for (const [name, referent] of filteredNeededLibraries) {
				const innerDir = await getInner(referent);
				const libraryFile = await innerDir.tryGet(name);
				if (libraryFile !== null) {
					tg.File.assert(libraryFile);
					const isolatedDir = await tg.directory({ name: libraryFile });
					isolatedPaths.push(isolatedDir);
				}
			}
			output.libraryPaths = isolatedPaths;
			break;
		}
		case "combine": {
			const entries: Record<string, tg.Artifact> = {};
			for (const [name, referent] of filteredNeededLibraries) {
				const innerDir = await getInner(referent);
				const libraryFile = await innerDir.tryGet(name);
				if (libraryFile !== null) {
					tg.File.assert(libraryFile);
					entries[name] = libraryFile;
				}
			}
			output.libraryPaths =
				Object.keys(entries).length === 0 ? [] : [await tg.directory(entries)];
			break;
		}
		default: {
			throw new Error(`unexpected library path strategy: ${strategy}`);
		}
	}

	return output;
}

async function getNeededLibraries(executable: tg.File): Promise<Array<string>> {
	const metadata = await std.file.executableMetadata(executable);
	function fileName(path: string) {
		return path.split("/").pop();
	}
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
}

type DirWithSubpath = {
	dir: tg.Directory;
	subpath?: string;
};

async function createLibraryPathSet(
	libraryPaths: Array<tg.Template.Arg>,
): Promise<Set<DirWithSubpath>> {
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
			const artifact = await path.artifact;
			if (artifact !== null) {
				tg.Directory.assert(artifact);
				let ret: DirWithSubpath = { dir: artifact };
				const subpath = await path.path;
				if (subpath !== null) {
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
}

/** If the template represetns a directory and optional subpath, return it. Otherwise, undefined. */
async function tryTemplateToDirWithSubpath(
	t: tg.Template,
): Promise<DirWithSubpath | undefined> {
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
}

async function findTransitiveNeededLibraries(
	executable: tg.File,
	libraryPaths: Set<DirWithSubpath>,
	getNeededLibrariesForFile: (
		file: tg.File,
	) => Promise<Array<string>> = getNeededLibraries,
): Promise<Map<string, DirWithSubpath | undefined>> {
	const neededLibraries = new Map<string, DirWithSubpath | undefined>();
	const files = [executable];
	const visited = new Set<tg.File.Id>();
	while (files.length > 0) {
		const file = files.shift();
		tg.assert(file !== undefined);
		if (visited.has(file.id)) {
			continue;
		}
		visited.add(file.id);

		for (const name of await getNeededLibrariesForFile(file)) {
			// On macOS, libSystem is provided by the runtime.
			if (name.includes("libSystem")) {
				continue;
			}
			if (neededLibraries.get(name) !== undefined) {
				continue;
			}
			neededLibraries.set(name, undefined);
			for (const referent of libraryPaths) {
				const directory = await getInner(referent);
				const artifact = await directory.tryGet(name);
				if (artifact instanceof tg.File) {
					neededLibraries.set(name, referent);
					files.push(artifact);
					break;
				}
			}
		}
	}

	return neededLibraries;
}

async function templateArgFromDirWithSubpath(
	value: DirWithSubpath,
): Promise<tg.Template.Arg> {
	return value.subpath === undefined
		? value.dir
		: await tg`${value.dir}/${value.subpath}`;
}

/** Resovle all subpaths to the inner directory. */
async function resolvePaths(
	paths: Set<DirWithSubpath>,
): Promise<Array<tg.Directory>> {
	return await Promise.all([...paths].map(getInner));
}

async function getInner(dirWithSubpath: DirWithSubpath): Promise<tg.Directory> {
	const directory = dirWithSubpath.dir;
	let subpath = dirWithSubpath.subpath;
	if (subpath === undefined) {
		return directory;
	}
	if (subpath.startsWith("/")) {
		subpath = subpath.slice(1);
	}
	const inner = await directory.tryGet(subpath);
	if (inner !== null) {
		if (inner instanceof tg.Directory) {
			return inner;
		}
		const id = inner.id;
		throw new Error(`expected a directory, got ${id}`);
	} else {
		throw new Error(`could not get ${inner} from ${directory.id}`);
	}
}

/** Given a list of library paths, find all actual files and produce a new list containing directories with a single entry. */
async function separateLibraries(
	orig: Array<tg.Template.Arg>,
): Promise<Array<tg.Directory>> {
	const foundFiles: Array<[string, tg.File]> = [];
	function fileName(path: string) {
		return path.split("/").pop();
	}
	function isDylib(name: string) {
		return name.includes(".so") || name.includes(".dylib");
	}
	for (let pathTemplate of orig) {
		const dirWithSubpath = await tryTemplateToDirWithSubpath(
			await tg.template(pathTemplate),
		);
		if (dirWithSubpath === undefined) {
			continue;
		}
		const inner = await getInner(dirWithSubpath);
		for await (const [name, artifact] of inner) {
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
}

function valueIsTemplateLike(
	value: tg.Value,
): value is string | tg.Template | tg.Artifact {
	return (
		typeof value === "string" ||
		tg.Artifact.is(value) ||
		value instanceof tg.Template
	);
}

async function manifestMutationFromMutation(
	mutation: tg.Mutation,
	references?: ManifestReferences,
): Promise<wrap.Manifest.Mutation> {
	if (mutation.inner.kind === "unset") {
		return { kind: "unset" };
	} else if (mutation.inner.kind === "set") {
		const value = mutation.inner.value;
		return {
			kind: "set",
			value: await manifestValueFromValue(value, references),
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
				await manifestTemplateFromArg(value, references),
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
			template: await manifestTemplateFromArg(template, references),
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
			template: await manifestTemplateFromArg(template, references),
			separator: mutation.inner.separator ?? ":",
		};
	} else if (mutation.inner.kind === "prepend") {
		tg.assert(mutation.inner.values.every(valueIsTemplateLike));
		const values = await Promise.all(
			mutation.inner.values.map(async (arg) =>
				manifestValueFromManifestTemplate(
					await manifestTemplateFromArg(arg, references),
				),
			),
		);
		return { kind: "prepend", values };
	} else if (mutation.inner.kind === "append") {
		tg.assert(mutation.inner.values.every(valueIsTemplateLike));
		const values = await Promise.all(
			mutation.inner.values.map(async (arg) =>
				manifestValueFromManifestTemplate(
					await manifestTemplateFromArg(arg, references),
				),
			),
		);
		return { kind: "append", values };
	} else if (mutation.inner.kind === "merge") {
		const value = mutation.inner.value;
		tg.assert(tg.Value.isMap(value), "expected a map");
		const manifestValue = await manifestValueFromValue(value, references);
		tg.assert(
			manifestValue !== null &&
				typeof manifestValue === "object" &&
				!Array.isArray(manifestValue) &&
				manifestValue.kind === "map",
		);
		return { kind: "merge", value: manifestValue };
	} else {
		return tg.unreachable();
	}
}

function manifestValueFromManifestTemplate(
	template: wrap.Manifest.Template,
): wrap.Manifest.Value {
	return {
		kind: "template",
		value: template,
	};
}

export async function fileOrSymlinkFromManifestTemplate(
	manifestTemplate: wrap.Manifest.Template,
	references?: ManifestReferences,
	tokens?: tg.Authorization.Tokens,
): Promise<tg.File | tg.Symlink> {
	let template = await templateFromManifestTemplate(
		manifestTemplate,
		references,
		tokens,
	);
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
}

function templateFromManifestTemplate(
	manifestTemplate: wrap.Manifest.Template,
	references?: ManifestReferences,
	tokens?: tg.Authorization.Tokens,
): PromiseLike<tg.Template> {
	return manifestTemplate.components.reduce<PromiseLike<tg.Template>>(
		(result, component) => {
			switch (component.kind) {
				case "artifact": {
					const artifact = inheritManifestReference(
						tg.Artifact.withId(component.value),
						references,
						tokens,
					);
					return tg`${result}${artifact}`;
				}
				case "string": {
					return tg`${result}${component.value}`;
				}
				case "placeholder": {
					return tg`${result}${tg.placeholder(component.value)}`;
				}
			}
		},
		tg``,
	);
}

function mutationFromManifestMutation(
	manifestMutation: wrap.Manifest.Mutation,
	references?: ManifestReferences,
	tokens?: tg.Authorization.Tokens,
): PromiseLike<tg.Mutation> {
	if (manifestMutation.kind === "unset") {
		return Promise.resolve(tg.Mutation.unset());
	} else if (manifestMutation.kind === "set") {
		return tg.Mutation.set(
			valueFromManifestValue(manifestMutation.value, references, tokens),
		);
	} else if (manifestMutation.kind === "set_if_unset") {
		return tg.Mutation.setIfUnset(
			valueFromManifestValue(manifestMutation.value, references, tokens),
		);
	} else if (manifestMutation.kind === "prepend") {
		return tg.Mutation.prepend(
			manifestMutation.values.map((value) =>
				valueFromManifestValue(value, references, tokens),
			),
		);
	} else if (manifestMutation.kind === "append") {
		return tg.Mutation.append(
			manifestMutation.values.map((value) =>
				valueFromManifestValue(value, references, tokens),
			),
		);
	} else if (manifestMutation.kind === "prefix") {
		return tg.Mutation.prefix(
			templateFromManifestTemplate(
				manifestMutation.template,
				references,
				tokens,
			),
			manifestMutation.separator,
		);
	} else if (manifestMutation.kind === "suffix") {
		return tg.Mutation.suffix(
			templateFromManifestTemplate(
				manifestMutation.template,
				references,
				tokens,
			),
			manifestMutation.separator,
		);
	} else if (manifestMutation.kind === "merge") {
		const value = valueFromManifestValue(
			manifestMutation.value,
			references,
			tokens,
		).then((v) => {
			tg.assert(tg.Value.isMap(v));
			return v;
		});
		return tg.Mutation.merge(value);
	} else {
		return tg.unreachable();
	}
}

async function manifestValueFromValue(
	value: tg.Value,
	references?: ManifestReferences,
): Promise<wrap.Manifest.Value> {
	if (value === null) {
		return null;
	} else if (typeof value === "boolean") {
		return value;
	} else if (typeof value === "number") {
		return value;
	} else if (typeof value === "string") {
		return value;
	} else if (value instanceof tg.Directory) {
		if (references !== undefined) {
			await addManifestReference(references, value);
		} else {
			await value.store();
		}
		return { kind: "directory", value: value.id };
	} else if (value instanceof tg.File) {
		if (references !== undefined) {
			await addManifestReference(references, value);
		} else {
			await value.store();
		}
		return { kind: "file", value: value.id };
	} else if (value instanceof tg.Symlink) {
		if (references !== undefined) {
			await addManifestReference(references, value);
		} else {
			await value.store();
		}
		return { kind: "symlink", value: value.id };
	} else if (value instanceof tg.Template) {
		return {
			kind: "template",
			value: await manifestTemplateFromArg(value, references),
		};
	} else if (value instanceof tg.Mutation) {
		return {
			kind: "mutation",
			value: await manifestMutationFromMutation(value, references),
		};
	} else if (value instanceof Array) {
		return await Promise.all(
			value.map((value) => manifestValueFromValue(value, references)),
		);
	} else if (typeof value === "object") {
		const obj: { [key: string]: wrap.Manifest.Value } = {};
		const entries = Object.entries(value);
		const promises = entries.map(async ([key, val]) => {
			return { key, value: await manifestValueFromValue(val, references) };
		});
		const resolvedEntries = await Promise.all(promises);
		for (const entry of resolvedEntries) {
			obj[entry.key] = entry.value;
		}
		return { kind: "map", value: obj };
	} else {
		return tg.unreachable();
	}
}

async function valueFromManifestValue(
	value: wrap.Manifest.Value,
	references?: ManifestReferences,
	tokens?: tg.Authorization.Tokens,
): Promise<tg.Value> {
	if (value instanceof Array) {
		return await Promise.all(
			value.map((value) => valueFromManifestValue(value, references, tokens)),
		);
	} else if (value === null) {
		return null;
	} else if (typeof value === "boolean") {
		return value;
	} else if (typeof value === "number") {
		return value;
	} else if (typeof value === "string") {
		return value;
	} else if (value.kind === "directory") {
		return inheritManifestReference(
			tg.Directory.withId(value.value),
			references,
			tokens,
		);
	} else if (value.kind === "file") {
		return inheritManifestReference(
			tg.File.withId(value.value),
			references,
			tokens,
		);
	} else if (value.kind === "symlink") {
		return inheritManifestReference(
			tg.Symlink.withId(value.value),
			references,
			tokens,
		);
	} else if (value.kind === "template") {
		return await templateFromManifestTemplate(value.value, references, tokens);
	} else if (value.kind === "mutation") {
		return mutationFromManifestMutation(value.value, references, tokens);
	} else if (value.kind === "map") {
		const ret: tg.Value = {};
		const entries = Object.entries(value.value);
		const promises = entries.map(async ([key, val]) => {
			return {
				key,
				value: await valueFromManifestValue(val, references, tokens),
			};
		});
		const resolvedEntries = await Promise.all(promises);
		for (const entry of resolvedEntries) {
			ret[entry.key] = entry.value;
		}
		return ret;
	} else {
		return tg.unreachable();
	}
}

/** Yield the key/value pairs this manifest sets once all mutations are applied. */
export async function* manifestEnvVars(
	manifest: wrap.Manifest,
	tokens: tg.Authorization.Tokens,
): AsyncGenerator<[string, tg.Template | undefined]> {
	yield* std.env.envVars(
		await wrap.envObjectFromManifestEnv(manifest.env, undefined, tokens),
	);
}

async function manifestTemplateFromArg(
	arg: tg.Template.Arg | wrap.Manifest.Template,
	references?: ManifestReferences,
): Promise<wrap.Manifest.Template> {
	if (isManifestTemplate(arg)) {
		return arg as wrap.Manifest.Template;
	}
	const t = await tg.template(arg);
	const components: Array<wrap.Manifest.Template.Component> = await Promise.all(
		t.components.map(async (component) => {
			if (typeof component === "string") {
				return { kind: "string", value: component };
			} else if (component instanceof tg.Placeholder) {
				return { kind: "placeholder", value: component.name };
			} else {
				if (references !== undefined) {
					await addManifestReference(references, component);
				} else {
					await component.store();
				}
				return { kind: "artifact", value: component.id };
			}
		}),
	);
	return {
		components: components ?? [],
	};
}

async function envObjectFromMapValue(
	value: wrap.Manifest.Value,
	references?: ManifestReferences,
	tokens?: tg.Authorization.Tokens,
): Promise<std.env.EnvObject> {
	tg.assert(
		value !== null &&
			!(value instanceof Array) &&
			typeof value === "object" &&
			value.kind === "map",
		"Malformed env, expected a map of mutations.",
	);
	const ret: std.env.EnvObject = {};
	for (const [key, val] of Object.entries(value.value)) {
		if (val instanceof Array) {
			return tg.unreachable();
		} else if (
			val !== null &&
			typeof val === "object" &&
			val.kind === "mutation"
		) {
			ret[key] = (await mutationFromManifestMutation(
				val.value,
				references,
				tokens,
			)) as tg.Mutation<tg.Template.Arg>;
		} else {
			throw new Error(
				"Malformed env, expected a mutation or array of mutations.",
			);
		}
	}
	return ret;
}

function isManifestTemplate(
	arg: tg.Template.Arg | wrap.Manifest.Template,
): arg is wrap.Manifest.Template {
	return (
		typeof arg === "object" &&
		arg !== null &&
		"components" in arg &&
		typeof arg.components === "object" &&
		arg.components instanceof Array &&
		arg.components.every(isManifestTemplateComponent)
	);
}

function isManifestTemplateComponent(
	arg: unknown,
): arg is wrap.Manifest.Template.Component {
	return (
		typeof arg === "object" &&
		arg !== null &&
		"kind" in arg &&
		(arg.kind === "string" ||
			arg.kind === "artifact" ||
			arg.kind === "placeholder")
	);
}

/** Yield the objects referenced by a manifest. */
export function* manifestDependencies(
	manifest: wrap.Manifest,
): Generator<tg.Object> {
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
		case "ld-linux":
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
			for (const arg of manifest.interpreter.args ?? []) {
				yield* manifestTemplateDependencies(arg);
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
function* manifestMutationDependencies(
	mutation: wrap.Manifest.Mutation,
): Generator<tg.Object> {
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
		case "merge":
			yield* manifestValueDependencies(mutation.value);
			break;
	}
}

/** Yield the artifacts references by an executable. */
function* manifestExecutableDependencies(
	executable: wrap.Manifest.Executable,
): Generator<tg.Object> {
	if (executable.kind === "address") {
		return;
	}
	yield* manifestTemplateDependencies(executable.value);
}

/** Yield the artifacts referenced by a template. */
function* manifestTemplateDependencies(
	template: wrap.Manifest.Template,
): Generator<tg.Object> {
	for (const component of template.components) {
		if (component.kind === "artifact") {
			yield tg.Artifact.withId(component.value);
		}
	}
}

/** Yield the artifacts referenced by a value. */
export function* manifestValueDependencies(
	value: wrap.Manifest.Value,
): Generator<tg.Object> {
	if (value === null) {
		return;
	}
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

type BuildAndHostArg = {
	build?: string;
	host?: string;
};

/** Basic program for testing the wrapper code. */
export async function argAndEnvDump(arg?: BuildAndHostArg) {
	const host = arg?.host ?? std.triple.host();
	const build = arg?.build ?? host;

	const isCross = build !== host;
	const buildToolchain = isCross
		? gnu.toolchain({ host: build, target: host })
		: bootstrap.sdk(bootstrap.toolchainTriple(host));

	const targetPrefix = isCross ? `${host}-` : "";
	return await std
		.build(
			std.shBootstrap`${targetPrefix}cc -xc ${inspectProcessSource} -o ${tg.output}`,
		)
		.env(buildToolchain, {
			TGLD_TRACING: "tgld=trace",
			TANGRAM_WRAPPER_TRACING: "tangram_wrapper=trace",
		})
		.then(tg.File.expect);
}

export function argAndEnvDumpCross() {
	return argAndEnvDump({
		build: "aarch64-unknown-linux-gnu",
		host: "x86_64-unknown-linux-gnu",
	});
}

/**
 * Reproduces the wrapper SEGV that occurs when a wrapped binary is invoked on
 * a host that has neither /.tangram/store nor /opt/tangram/store.
 */
export async function demoFindStoreDirHostRun() {
	const exe = await argAndEnvDump();
	return tg.command({
		executable: { path: "/bin/bash" },
		args: ["-c", await tg`exec ${exe} hello`, "--"],
	});
}

export async function test() {
	await Promise.all([
		tg.build(testSingleArgObjectNoMutations, {
			name: "single arg object no mutations",
		}),
		tg.build(wrapperModule.testWrapperPositionIndependent, {
			name: "position-independent wrapper",
		}),
		tg.build(wrapperModule.testStatic, { name: "static executable" }),
		tg.build(wrapperModule.testBssManifest, { name: "BSS manifest" }),
		tg.build(wrapperModule.testStripPreservesManifest, {
			name: "strip preserves manifest",
		}),
		tg.build(testConcurrentRelink, { name: "concurrent relink" }),
		tg.build(testConcurrentRelinkStandalone, {
			name: "concurrent relink standalone",
		}),
		tg.build(testConcurrentRelinkTransient, {
			name: "concurrent relink transient",
		}),
		tg.build(testDependencies, { name: "dependencies" }),
		tg.build(testDylibPath, { name: "dylib path" }),
		tg.build(testEnvObjectFromArtifactAuthorization, {
			name: "env object from artifact authorization",
		}),
		tg.build(testFilterLibraryPathsWithoutExecutable, {
			name: "filter library paths without executable",
		}),
		tg.build(testContentExecutable, { name: "content executable" }),
		tg.build(testContentExecutableVariadic, {
			name: "content executable variadic",
		}),
		tg.build(testManifestDependenciesDynamicInterpreterArgs, {
			name: "manifest dependencies dynamic interpreter args",
		}),
		tg.build(testManifestDependenciesMergeMutation, {
			name: "manifest dependencies merge mutation",
		}),
		tg.build(testDarwinLargeManifestOverwrite, {
			name: "Darwin large manifest overwrite",
		}),
		tg.build(testManifestMutationPrependRoundTrip, {
			name: "manifest mutation prepend round trip",
		}),
		tg.build(testManifestTemplateAuthorization, {
			name: "manifest template authorization",
		}),
		tg.build(testManifestTemplatePlaceholderRoundTrip, {
			name: "manifest template placeholder round trip",
		}),
		tg.build(testManifestWriteRequiresAuthorizedReferences, {
			name: "manifest write requires authorized references",
		}),
		tg.build(testMergeFalseDoesNotReuseManifest, {
			name: "merge false does not reuse manifest",
		}),
		tg.build(testMergeFalsePreservesWrapperExecutable, {
			name: "merge false preserves wrapper executable",
		}),
		tg.build(testMergedWrapperArgumentOrder, {
			name: "merged wrapper argument order",
		}),
		tg.build(testNeededLibrariesAuthorization, {
			name: "needed libraries authorization",
		}),
		tg.build(testOptimizeLibraryPathsDoesNotMutateInput, {
			name: "optimize library paths does not mutate input",
		}),
		tg.build(testTransitiveNeededLibraries, {
			name: "transitive needed libraries",
		}),
		tg.build(testInterpreterSwappingNormal, {
			name: "interpreter swapping normal",
		}),
		tg.build(testInterpreterNull, {
			name: "interpreter null",
		}),
		tg.build(testInterpreterWrappingPreloads, {
			name: "interpreter wrapping preloads",
		}),
	]);
	return true;
}

export async function testSingleArgObjectNoMutations() {
	const executable = await argAndEnvDump();
	await executable.store();
	const executableID = executable.id;

	// The program is a wrapper produced by the LD proxy.
	console.log("argAndEnvDump wrapper ID", executableID);

	// Get the value of the original executable.
	const origManifest = await wrap.Manifest.read(executable);
	tg.assert(origManifest);
	const origManifestExecutable = origManifest.executable;

	const buildToolchain = await bootstrap.sdk.env(std.triple.host());

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
	const output = await std
		.build(std.shBootstrap`${wrapper} > ${tg.output}`)
		.then(tg.File.expect);
	const text = await output.text;
	console.log("text", text);

	const os = std.triple.os(std.triple.host());

	if (os === "linux") {
		tg.assert(
			text.includes(`/proc/self/exe: /opt/tangram/store/${wrapperID}`),
			"Expected /proc/self/exe to be set to the artifact ID of the wrapper",
		);
		tg.assert(
			text.includes(`argv[0]: /opt/tangram/store/${wrapperID}`),
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
		const wrapperStorePath = `.*/store/${wrapperID}`;
		tg.assert(
			text.match(new RegExp(`_NSGetExecutablePath: ${wrapperStorePath}`)),
			"Expected _NSGetExecutablePath to point to the wrapper",
		);
		tg.assert(
			text.match(new RegExp(`argv\\[0\\]: ${wrapperStorePath}`)),
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
}

export async function testBasicCross() {
	const detectedBuild = std.triple.host();
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
}

export async function testContentExecutable() {
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
	const output = await std
		.build(std.shBootstrap`set -x; ${wrapper} > ${tg.output}`)
		.env({ TANGRAM_WRAPPER_TRACING: "tangram_wrapper=trace" })
		.then(tg.File.expect);
	const text = await output.text.then((t) => t.trim());
	console.log("text", text);
	tg.assert(text.includes("Tangram"));

	return true;
}

export async function testContentExecutableVariadic() {
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
	const output = await std
		.build(std.shBootstrap`set -x; ${wrapper} > ${tg.output}`)
		.env({ TANGRAM_WRAPPER_TRACING: "tangram_wrapper=trace" })
		.then(tg.File.expect);
	const text = await output.text.then((t) => t.trim());
	console.log("text", text);
	tg.assert(text.includes("Tangram"));

	return true;
}

export async function testDependencies() {
	const buildToolchain = bootstrap.sdk();
	const transitiveDependency = await tg.file("I'm a transitive reference");
	await transitiveDependency.store();
	const transitiveDependencyId = transitiveDependency.id;
	console.log("transitiveReference", transitiveDependencyId);
	const binDir = await tg.directory({
		bin: {
			foo: tg.file("hi", {
				executable: true,
				dependencies: {
					transitiveDependencyId: { node: transitiveDependency, options: {} },
				},
			}),
		},
	});
	await binDir.store();
	console.log("binDir", binDir.id);

	const wrapper = await std.wrap({
		buildToolchain,
		executable: "foo",
		env: {
			PATH: tg`${binDir}/bin`,
		},
	});
	await wrapper.store();
	console.log("wrapper", wrapper.id);
	const wrapperDependencies = await wrapper.dependencies;
	console.log("wrapperDependencies", wrapperDependencies);

	const bundle = tg.bundle(await tg.directory({ wrapper }));
	return bundle;
}

import libGreetSource from "./wrap/test/greet.c" with { type: "file" };
import driverSource from "./wrap/test/driver.c" with { type: "file" };
export async function testDylibPath() {
	const host = std.triple.host();
	const os = std.triple.os(host);
	const dylibExt = os === "darwin" ? "dylib" : "so";

	// Obtain a non-proxied toolchain env from the bootstrap
	const bootstrapSdk = bootstrap.sdk(host);

	// Compile the greet library
	const sharedLibraryDir = await std
		.build(
			std.shBootstrap`mkdir -p ${tg.output}/lib && cc -shared -fPIC -xc -o ${tg.output}/lib/libgreet.${dylibExt} ${libGreetSource}`,
		)
		.env(bootstrapSdk)
		.then(tg.Directory.expect);
	await sharedLibraryDir.store();
	console.log("sharedLibraryDir", sharedLibraryDir.id);

	// Compile the driver.
	const driver = await std
		.build(std.shBootstrap`cc -xc -o ${tg.output} ${driverSource} -ldl`)
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
}

export async function testManifestTemplateAuthorization() {
	const directory = await tg.directory({ library: tg.file("library") });
	await directory.store();
	tg.assert(hasTokens(directory));

	const serializedReferences: ManifestReferences = new Map();
	const manifestTemplate = await manifestTemplateFromArg(
		directory,
		serializedReferences,
	);
	tg.assert(serializedReferences.get(directory.id) === directory);

	const parsedReferences: ManifestReferences = new Map();
	const template = await templateFromManifestTemplate(
		manifestTemplate,
		parsedReferences,
		directory.state.tokens,
	);
	const [artifact] = template.components;
	tg.assert(artifact instanceof tg.Directory);
	const artifactTokens = artifact.state.tokens;
	const directoryTokens = directory.state.tokens;
	const locations = Object.keys(directoryTokens);
	tg.assert(
		locations.length === Object.keys(artifactTokens).length &&
			locations.every(
				(location) => artifactTokens[location] === directoryTokens[location],
			),
		"expected the manifest template artifact to retain its authorization tokens",
	);
	tg.assert(parsedReferences.get(directory.id) === artifact);

	return true;
}

export async function testManifestMutationPrependRoundTrip() {
	const mutation = await tg.Mutation.prepend(["first", "second"]);
	const manifestMutation = await manifestMutationFromMutation(mutation);
	const roundTrippedMutation =
		await mutationFromManifestMutation(manifestMutation);

	tg.assert(
		roundTrippedMutation.inner.kind === "prepend",
		"expected a prepend mutation to remain a prepend mutation",
	);

	return true;
}

/** Replacing a Mach-O manifest must grow the mapped __LINKEDIT segment with the file data. */
export async function testDarwinLargeManifestOverwrite() {
	if (std.triple.os(std.triple.host()) !== "darwin") {
		return true;
	}

	const executable = {
		kind: "content" as const,
		value: await manifestTemplateFromArg("exit 0"),
	};
	const initial = await wrap.Manifest.write(
		await testWrapperBinary(),
		{ executable },
		new Map(),
	);
	const values = Array.from(
		{ length: 32 },
		(_, index) => `${index}:${"x".repeat(1024)}`,
	);
	const rewritten = await wrap.Manifest.write(
		initial,
		{
			executable,
			args: await Promise.all(
				values.map((value) => manifestTemplateFromArg(value)),
			),
		},
		new Map(),
	);

	const output = await tg
		.build(
			std.shBootstrap`${rewritten} --tangram-print-manifest > ${tg.output}`,
		)
		.then(tg.File.expect);
	const manifest = tg.encoding.json.decode(await output.text) as wrap.Manifest;
	tg.assert(
		manifest.args?.length === values.length &&
			manifest.args.every((arg, index) => {
				const component = arg.components[0];
				return (
					component?.kind === "string" && component.value === values[index]
				);
			}),
		"large manifest did not round trip through the mapped image",
	);

	return true;
}

export async function testManifestDependenciesDynamicInterpreterArgs() {
	const dependency = await tg.file("dynamic interpreter argument");
	const interpreter = await tg.file("interpreter");
	await dependency.store();
	const dependencyTemplate = await manifestTemplateFromArg(dependency);
	const manifest: wrap.Manifest = {
		executable: {
			kind: "content",
			value: await manifestTemplateFromArg("executable"),
		},
		interpreter: {
			args: [dependencyTemplate],
			kind: "ld-linux",
			path: await manifestTemplateFromArg(interpreter),
		},
	};
	const dependencyIds = new Set<tg.Object.Id>();
	for await (const dependency of manifestDependencies(manifest)) {
		dependencyIds.add(dependency.id);
	}

	tg.assert(
		dependencyIds.has(dependency.id),
		"expected dynamic interpreter arguments to be manifest dependencies",
	);

	return true;
}

export async function testManifestDependenciesMergeMutation() {
	const dependency = await tg.directory({ dependency: tg.file("dependency") });
	await dependency.store();
	const manifest: wrap.Manifest = {
		env: {
			kind: "merge",
			value: {
				kind: "map",
				value: {
					DEPENDENCY: {
						kind: "directory",
						value: dependency.id,
					},
				},
			},
		},
		executable: {
			kind: "content",
			value: await manifestTemplateFromArg("executable"),
		},
	};
	const dependencyIds = new Set<tg.Object.Id>();
	for await (const dependency of manifestDependencies(manifest)) {
		dependencyIds.add(dependency.id);
	}

	tg.assert(
		dependencyIds.has(dependency.id),
		"expected merge mutation values to be manifest dependencies",
	);

	return true;
}

export async function testManifestTemplatePlaceholderRoundTrip() {
	const manifestTemplate = await manifestTemplateFromArg(
		await tg.template(tg.placeholder("test")),
	);
	const template = await templateFromManifestTemplate(manifestTemplate);
	const [component] = template.components;

	tg.assert(component instanceof tg.Placeholder);
	tg.assert(component.name === "test");

	return true;
}

export async function testManifestWriteRequiresAuthorizedReferences() {
	const dependency = await tg.file("dependency");
	await dependency.store();
	const manifest: wrap.Manifest = {
		executable: {
			kind: "path",
			value: await manifestTemplateFromArg(dependency),
		},
	};
	let error: unknown;
	try {
		await validateManifestReferences(manifest, new Map());
	} catch (caught) {
		error = caught;
	}

	tg.assert(
		error instanceof Error,
		"expected an incomplete manifest reference graph to be rejected",
	);

	return true;
}

export async function testMergeFalsePreservesWrapperExecutable() {
	const executable = await tg.file("executable", { executable: true });
	const references: ManifestReferences = new Map();
	const executableTemplate = await manifestTemplateFromArg(
		executable,
		references,
	);
	const innerWrapper = await wrap.Manifest.write(
		await testWrapperBinary(),
		{
			executable: {
				kind: "path",
				value: executableTemplate,
			},
			interpreter: {
				kind: "normal",
				path: executableTemplate,
			},
		},
		references,
	);
	const outerWrapper = await wrap(innerWrapper, { merge: false });
	const outerManifest = await wrap.Manifest.read(outerWrapper);
	tg.assert(outerManifest !== undefined);
	tg.assert(outerManifest.executable.kind === "path");
	const outerExecutable = await fileOrSymlinkFromManifestTemplate(
		outerManifest.executable.value,
	);

	tg.assert(
		outerExecutable.id === innerWrapper.id,
		"expected merge=false to preserve the existing wrapper as the executable",
	);

	return true;
}

export async function testMergeFalseDoesNotReuseManifest() {
	const existingManifest: wrap.Manifest = {
		executable: {
			kind: "content",
			value: await manifestTemplateFromArg("executable"),
		},
	};
	const selectedManifest = existingManifestForWrap(false, existingManifest);

	tg.assert(
		selectedManifest === undefined,
		"expected merge=false not to reuse the existing manifest",
	);

	return true;
}

export async function testMergedWrapperArgumentOrder() {
	const args = mergeWrapArgs(["new"], ["existing"]);

	tg.assert(
		args[0] === "existing" && args[1] === "new",
		"expected existing bound arguments to precede newly bound arguments",
	);

	return true;
}

export async function testEnvObjectFromArtifactAuthorization() {
	const dependency = await tg.directory({ dependency: tg.file("dependency") });
	const references: ManifestReferences = new Map();
	const manifestEnv = await wrap.manifestEnvFromEnvObject(
		{
			DEPENDENCY: await tg.Mutation.set(dependency),
		},
		references,
	);
	tg.assert(manifestEnv !== undefined);
	const wrapper = await wrap.Manifest.write(
		await testWrapperBinary(),
		{
			env: manifestEnv,
			executable: {
				kind: "content",
				value: await manifestTemplateFromArg("executable"),
			},
		},
		references,
	);
	const env = await std.env.compose(wrapper);
	const mutation = env.DEPENDENCY;
	tg.assert(mutation instanceof tg.Mutation);
	tg.assert(mutation.inner.kind === "set");
	const value = mutation.inner.value;
	tg.assert(value instanceof tg.Template);
	tg.assert(value.components.length === 1);
	const component = value.components[0];
	tg.assert(component instanceof tg.Directory);

	tg.assert(
		hasTokens(component),
		"expected envObjectFromArtifact to retain the wrapper authorization tokens",
	);

	return true;
}

export async function testNeededLibrariesAuthorization() {
	const executable = await testWrapperBinary();
	const references: ManifestReferences = new Map();
	const executableTemplate = await manifestTemplateFromArg(
		executable,
		references,
	);
	const wrapper = await wrap.Manifest.write(
		executable,
		{
			executable: {
				kind: "path",
				value: executableTemplate,
			},
			interpreter: {
				kind: "ld-linux",
				path: executableTemplate,
			},
		},
		references,
	);
	const neededLibraries = await wrap.neededLibraries(wrapper);

	tg.assert(Array.isArray(neededLibraries));

	return true;
}

export async function testFilterLibraryPathsWithoutExecutable() {
	const first = await tg.directory({ first: tg.file("first") });
	const second = await tg.directory({ second: tg.file("second") });
	const interpreter: wrap.DyLdInterpreter = {
		kind: "dyld",
		libraryPaths: [first, second],
	};
	const optimized = await optimizeLibraryPaths({
		interpreter,
		libraryPathStrategy: "filter",
	});

	tg.assert(
		optimized.libraryPaths?.length === 0,
		"expected filter to remove paths containing no needed libraries",
	);

	return true;
}

export async function testOptimizeLibraryPathsDoesNotMutateInput() {
	const first = await tg.directory({ first: tg.file("first") });
	const second = await tg.directory({ second: tg.file("second") });
	const libraryPaths = [first];
	const interpreter: wrap.DyLdInterpreter = {
		kind: "dyld",
		libraryPaths,
	};
	await optimizeLibraryPaths({
		interpreter,
		libraryPaths: [second],
		libraryPathStrategy: "none",
	});

	tg.assert(
		interpreter.libraryPaths === libraryPaths && libraryPaths.length === 1,
		"expected library path optimization not to mutate its input",
	);

	return true;
}

export async function testTransitiveNeededLibraries() {
	const executable = await tg.file("executable");
	const direct = await tg.file("direct");
	const transitive = await tg.file("transitive");
	const libraryPath = await tg.directory({
		"libdirect.so": direct,
		"libtransitive.so": transitive,
	});
	const neededLibraries = await findTransitiveNeededLibraries(
		executable,
		new Set([{ dir: libraryPath }]),
		async (file) => {
			if (file.id === executable.id) {
				return ["libdirect.so"];
			} else if (file.id === direct.id) {
				return ["libtransitive.so"];
			} else {
				return [];
			}
		},
	);

	tg.assert(neededLibraries.get("libdirect.so") !== undefined);
	tg.assert(neededLibraries.get("libtransitive.so") !== undefined);

	return true;
}

async function testWrapperBinary(): Promise<tg.File> {
	const host = std.triple.host();
	const build =
		std.triple.os(host) === "linux" ? bootstrap.toolchainTriple(host) : host;
	return tg
		.build(workspace.wrapper, { build, host })
		.named("test wrapper binary")
		.then(tg.File.expect);
}

export async function testInterpreterSwappingNormal() {
	const buildToolchain = await bootstrap.sdk(std.triple.host());

	// Create a simple bash interpreter wrapper for testing
	const bashExecutable = await std.utils.bash
		.build({ sdk: "none", env: buildToolchain })
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
}

export async function testInterpreterNull() {
	const host = std.triple.host();
	const buildToolchain = await bootstrap.sdk.env(host);
	const executable = await argAndEnvDump();

	const detected = await wrap(executable, { buildToolchain });
	const detectedManifest = await wrap.Manifest.read(detected);
	tg.assert(detectedManifest !== undefined);
	tg.assert(
		detectedManifest.interpreter !== undefined,
		"expected an interpreter to be detected from the executable",
	);

	const suppressed = await wrap(executable, {
		buildToolchain,
		interpreter: null,
	});
	const suppressedManifest = await wrap.Manifest.read(suppressed);
	tg.assert(suppressedManifest !== undefined);
	tg.assert(
		suppressedManifest.interpreter === undefined,
		"expected `interpreter: null` to suppress detection",
	);

	const merged = await wrap(detected, {
		buildToolchain,
		interpreter: null,
		merge: true,
	});
	const mergedManifest = await wrap.Manifest.read(merged);
	tg.assert(mergedManifest !== undefined);
	tg.assert(
		mergedManifest.interpreter === undefined,
		"expected `interpreter: null` to drop the interpreter from the existing manifest",
	);

	return true;
}

export async function testInterpreterWrappingPreloads() {
	const host = std.triple.host();
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

	const testExecutable = await std
		.build(std.shBootstrap`cc -xc -o ${tg.output} ${testSource}`)
		.env(bootstrapSdk)
		.then(tg.File.expect);

	// Create a simple shared library that can be used as a preload.
	const preloadSource = tg.file(`
		#include <stdio.h>
		void __attribute__((constructor)) init() {
			fprintf(stderr, "Custom preload loaded\\n");
		}
	`);

	const customPreloadLib = await std
		.build(
			std.shBootstrap`cc -shared -fPIC -xc -o ${tg.output} ${preloadSource}`,
		)
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
}

import helloSource from "./wrap/test/hello.c" with { type: "file" };
import callHelloSource from "./wrap/test/call_hello.c" with { type: "file" };
import dlopenSource from "./wrap/test/dlopen.c" with { type: "file" };
import printEnvSource from "./wrap/test/print_env.c" with { type: "file" };
export async function testLoadThroughEnvLdLibraryPath() {
	const host = std.triple.host();
	const os = std.triple.os(host);
	const expectedKind = os === "darwin" ? "dyld" : "ld-musl";

	const toolchain = await bootstrap.sdk(host);
	const libHello = await std
		.run(std.shBootstrap`
		mkdir -p ${tg.output}/lib
		cp ${helloSource} libhello.c
		gcc -fPIC -shared -Wl,-soname,libhello.so -o ${tg.output}/lib/libhello.so libhello.c
	`)
		.env(toolchain)
		.then(tg.Directory.expect);
	// The inner `sh` must be a wrapped shell, which the bootstrap utils do not provide.
	const output = await std
		.run(std.sh({ bootstrap: true, utils: "shell" })`
		cp ${callHelloSource} callhello.c
		cp ${dlopenSource} dlopen.c
		gcc -fPIC -shared callhello.c -lhello -L${libHello}/lib -o call_hello
		gcc dlopen.c -o dlopen

		export LD_LIBRARY_PATH=${libHello}/lib
		sh -c 'TANGRAM_TRACING=1 ./dlopen > ${tg.output}'
	`)
		.env(toolchain)
		.then(tg.File.expect);
	const string = await output.text;
	const result = string === "hello, world!\n";
	tg.assert(result);
	return result;
}

/** Test that LD_LIBRARY_PATH is preserved through wrapped binary execution.
 *  This simulates the autotools build scenario:
 *  1. Build script sets export LD_LIBRARY_PATH=$LIBRARY_PATH
 *  2. A wrapped binary (like make) runs
 *  3. That wrapped binary spawns another wrapped binary (like python)
 *  4. The inner binary needs LD_LIBRARY_PATH to find transitive deps via dlopen
 *
 *  The old Rust wrapper preserved LD_LIBRARY_PATH via --library-path to ld-linux.
 *  The new C wrapper uses LD_LIBRARY_PATH env + injection library to restore it.
 */
export async function testLdLibraryPathPreservedThroughNestedWrapping() {
	const host = std.triple.host();
	const os = std.triple.os(host);
	if (os === "darwin") {
		return true; // Skip on macOS, different mechanism.
	}

	const toolchain = await bootstrap.sdk(host);

	// Build libhello.so in its own directory (simulates a transitive dependency).
	const libHello = std
		.run(std.shBootstrap`
		mkdir -p ${tg.output}/lib
		cp ${helloSource} libhello.c
		gcc -fPIC -shared -Wl,-soname,libhello.so -o ${tg.output}/lib/libhello.so libhello.c
	`)
		.env(toolchain)
		.then(tg.Directory.expect);

	// The inner `sh` must be a wrapped shell, which is the whole point of this test, and the bootstrap utils do not provide one.
	const output = await std
		.run(std.sh({ bootstrap: true, utils: "shell" })`
		cp ${callHelloSource} callhello.c
		cp ${printEnvSource} print_env.c
		gcc -fPIC -shared callhello.c -lhello -L${libHello}/lib -o call_hello.so
		gcc print_env.c -ldl -o print_env

		export LD_LIBRARY_PATH=${libHello}/lib
		echo "outer shell: LD_LIBRARY_PATH=$LD_LIBRARY_PATH" >&2

		# Level 1: wrapped sh (simulates make)
		sh -c '
			echo "inner shell: LD_LIBRARY_PATH=$LD_LIBRARY_PATH" >&2
			# Level 2: wrapped print_env (simulates python loading a module)
			TANGRAM_TRACING=1 ./print_env ./call_hello.so > ${tg.output}
		'
	`)
		.env(toolchain)
		.then(tg.File.expect);
	const string = await output.text;
	console.log("test output:", string);
	// print_env calls call_hello which calls hello_world → prints "hello, world!"
	const result = string === "hello, world!\n";
	tg.assert(result, `Expected "hello, world!\\n" but got "${string}"`);
	return result;
}

/** The program the concurrent relink tests wrap. */
const concurrentRelinkSource = tg.directory({
	"main.c": tg.file(`
		#include <stdio.h>
		int main() {
			printf("hello, world!\\n");
			return 0;
		}
	`),
});

const relinkWrapper = async (toolchain: std.env.Arg) => {
	const executable = await std
		.run(std.shBootstrap`
		cc ${concurrentRelinkSource}/main.c -o ${tg.output}
	`)
		.env(toolchain)
		.then(tg.File.expect);
	return await wrap(executable, { buildToolchain: toolchain });
};

/** Run `wrapper` from 16 concurrent workers, each replacing it with an atomic rename first. */
const atomicRelink = async (wrapper: tg.File) => {
	const workers = 16;
	const iterations = 150;
	const toolchain = await bootstrap.sdk(std.triple.host());

	const output = await std
		.build(std.shBootstrap`
		mkdir -p .libs
		cp ${wrapper} .libs/lt-prog

		i=1
		while [ $i -le ${workers.toString()} ]; do
			(
				j=0
				while [ $j -lt ${iterations.toString()} ]; do
					cp ${wrapper} .libs/$i-lt-prog
					mv -f .libs/$i-lt-prog .libs/lt-prog
					./.libs/lt-prog >> $i.log 2>&1
					j=$((j+1))
				done
			) &
			i=$((i+1))
		done
		wait

		cat *.log > ${tg.output}
	`)
		.env(toolchain)
		.then(tg.File.expect);

	const lines = await output.text.then((text) => text.split("\n").slice(0, -1));
	const failures = lines.filter((line) => line !== "hello, world!");
	tg.assert(
		failures.length === 0,
		`Expected every run to succeed, got ${failures.length} failures: ${failures.slice(0, 3).join(", ")}`,
	);
	tg.assert(
		lines.length === workers * iterations,
		`Expected ${workers * iterations} runs, got ${lines.length}`,
	);
	return true;
};

/** A libtool wrapper script renames a relinked binary over `.libs/lt-<name>` then execs it, so under `make -j` a wrapper can be replaced between its own exec and its first read of itself. */
export async function testConcurrentRelink() {
	const host = std.triple.host();
	return await atomicRelink(await relinkWrapper(await bootstrap.sdk(host)));
}

/** The same race against a standalone wrapper, which keeps its manifest elsewhere in the file and execs the program rather than userland-execing itself. */
export async function testConcurrentRelinkStandalone() {
	const host = std.triple.host();
	const sdkArg = await bootstrap.sdk.arg(host);
	const toolchain = await std.sdk({ ...sdkArg, embedWrapper: false });
	return await atomicRelink(await relinkWrapper(toolchain));
}

/** The same race against libtool's fallback, which removes `.libs/lt-<name>` before renaming into place, so the path is briefly absent. Runs the kernel could not exec are expected; a run it did exec must not fail inside the wrapper. */
export async function testConcurrentRelinkTransient() {
	const host = std.triple.host();
	const workers = 8;
	const iterations = 200;

	const toolchain = await bootstrap.sdk(host);
	const wrapper = await relinkWrapper(toolchain);

	const output = await std
		.build(std.shBootstrap`
		mkdir -p .libs
		cp ${wrapper} .libs/lt-prog

		i=1
		while [ $i -le ${workers.toString()} ]; do
			(
				j=0
				while [ $j -lt ${iterations.toString()} ]; do
					cp ${wrapper} .libs/$i-lt-prog
					# The bootstrap "rm" still reports ENOENT with "-f" if another worker wins.
					rm -f .libs/lt-prog || true
					mv -f .libs/$i-lt-prog .libs/lt-prog
					# Capture the status, since a failed exec would end the worker under "set -e".
					if result=$(./.libs/lt-prog 2>&1); then
						status=0
					else
						status=$?
					fi
					echo "$status|$result" >> $i.log
					j=$((j+1))
				done
			) &
			i=$((i+1))
		done
		wait

		cat *.log > ${tg.output}
	`)
		.env(toolchain)
		.then(tg.File.expect);

	const results = await output.text.then((text) =>
		text
			.split("\n")
			.filter((line) => line !== "")
			.map((line) => {
				const separator = line.indexOf("|");
				return {
					status: line.slice(0, separator),
					text: line.slice(separator + 1),
				};
			}),
	);
	tg.assert(
		results.length === workers * iterations,
		`Expected ${workers * iterations} runs, got ${results.length}`,
	);

	// The wrapper aborts with 111.
	const aborts = results.filter((result) => result.status === "111");
	tg.assert(
		aborts.length === 0,
		`Expected no wrapper failures, got ${aborts.length}: ${aborts
			.slice(0, 3)
			.map((abort) => `${abort.status}|${abort.text}`)
			.join(", ")}`,
	);

	const successes = results.filter((result) => result.status === "0");
	tg.assert(successes.length > 0, "Expected at least one run to succeed");

	// A run the kernel could not exec at all is expected. The status a shell reports for a failed
	// exec varies, so key on the message rather than on an allowlist of statuses.
	const isAbsentPathFailure = (result: (typeof results)[number]) => {
		const status = Number(result.status);
		return (
			status > 0 &&
			status < 128 &&
			/(?:not found|no such file or directory)/i.test(result.text)
		);
	};
	const unexpectedFailures = results.filter(
		(result) =>
			result.status !== "0" &&
			result.status !== "111" &&
			!isAbsentPathFailure(result),
	);
	tg.assert(
		unexpectedFailures.length === 0,
		`Expected every non-wrapper failure to be a missing-path exec failure, got ${unexpectedFailures.length} unexpected failures: ${unexpectedFailures
			.slice(0, 3)
			.map((failure) => `${failure.status}|${failure.text}`)
			.join(", ")}`,
	);

	// Without this the test passes vacuously when the timing never makes the path absent.
	const absent = results.filter(isAbsentPathFailure);
	tg.assert(
		absent.length > 0,
		"Expected at least one run to find the path absent",
	);
	const unexpected = successes.filter(
		(result) => result.text !== "hello, world!",
	);
	tg.assert(
		unexpected.length === 0,
		`Expected every successful run to print the greeting, got ${unexpected.length} with other output: ${unexpected
			.slice(0, 3)
			.map((result) => result.text)
			.join(", ")}`,
	);
	return true;
}
