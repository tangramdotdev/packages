import * as bootstrap from "./bootstrap.tg.ts";
import * as gcc from "./sdk/gcc.tg.ts";
import { interpreterName } from "./sdk/libc.tg.ts";
import * as std from "./tangram.tg.ts";
import * as injection from "./wrap/injection.tg.ts";
import * as workspace from "./wrap/workspace.tg.ts";

/** This module provides the `std.wrap()` function, which can be used to bundle an executable with a predefined environment and arguments, either of which may point to other Tangram artifacts.*/

/** Wrap an executable. */
export async function wrap(...args: tg.Args<wrap.Arg>): Promise<tg.File> {
	type Apply = {
		buildToolchain: std.env.Arg;
		host: string;
		identity: wrap.Identity;
		interpreter:
			| tg.File
			| tg.Symlink
			| wrap.Interpreter
			| wrap.Manifest.Interpreter
			| undefined;
		libraryPaths: Array<string | tg.Artifact | tg.Template>;
		executable: tg.File | tg.Symlink | wrap.Manifest.Executable;
		env: Array<std.env.Arg>;
		manifestArgs: Array<wrap.Manifest.Template>;
	};

	let {
		buildToolchain: buildToolchain_,
		host: host_,
		identity: identity_,
		libraryPaths,
		interpreter,
		executable: executable_,
		env: env_,
		manifestArgs,
	} = await tg.Args.apply<wrap.Arg, Apply>(args, async (arg) => {
		if (arg === undefined) {
			return {};
		} else if (tg.File.is(arg) || tg.Symlink.is(arg)) {
			let file;
			if (tg.Symlink.is(arg)) {
				file = await arg.resolve();
				tg.assert(
					file,
					`Could not resolve symlink ${await arg.id()} to a file.`,
				);
			} else {
				file = arg;
			}
			tg.File.assert(file);
			// Try to read the manifest from it.
			let existingManifest = await wrap.Manifest.read(file);
			if (existingManifest !== undefined) {
				let env_ = await wrap.envMapFromManifestEnv(existingManifest.env);
				let env = tg.Mutation.is(env_)
					? env_
					: await tg.Mutation.arrayAppend(env_);
				return {
					identity: existingManifest.identity,
					interpreter: existingManifest.interpreter,
					executable: existingManifest.executable,
					env,
					manifestArgs: existingManifest.args,
				};
			} else {
				let executable = await manifestExecutableFromArg(file);
				let manifestInterpreter =
					await manifestInterpreterFromExecutableArg(file);
				let ret: tg.MutationMap<Apply> = { executable };
				if (manifestInterpreter) {
					ret = {
						...ret,
						interpreter: manifestInterpreter,
					};
				}
				return ret;
			}
		} else if (typeof arg === "string" || tg.Template.is(arg)) {
			// This is a "content" executable.
			let executable = await manifestExecutableFromArg(arg);
			let defaultShell = await defaultShellInterpreter();
			let interpreter = await manifestInterpreterFromArg(defaultShell);
			return {
				identity: "executable",
				interpreter,
				executable,
			};
		} else if (isArgObject(arg)) {
			let object: tg.MutationMap<Apply> = {};
			if (arg.buildToolchain !== undefined) {
				object.buildToolchain = arg.buildToolchain;
			}
			if (arg.executable !== undefined) {
				if (
					tg.Template.is(arg.executable) ||
					typeof arg.executable === "string"
				) {
					object.executable = {
						kind: "content",
						value: await manifestTemplateFromArg(arg.executable),
					};
					if (!arg.interpreter) {
						let defaultShell = await defaultShellInterpreter(
							object.buildToolchain,
						);
						object.interpreter = await manifestInterpreterFromArg(
							defaultShell,
							object.buildToolchain,
						);
					}
					if (!arg.identity) {
						object.identity = "executable";
					}
				} else {
					let file;
					if (tg.Symlink.is(arg.executable)) {
						file = await arg.executable.resolve();
						tg.assert(
							file,
							`Could not resolve symlink ${await arg.executable.id()} to a file.`,
						);
					} else {
						file = arg.executable;
					}
					tg.File.assert(file);
					// Try to read the manifest from it.
					let existingManifest = await wrap.Manifest.read(file);
					if (existingManifest !== undefined) {
						let env_ = await wrap.envMapFromManifestEnv(existingManifest.env);
						let env = tg.Mutation.is(env_)
							? env_
							: await tg.Mutation.arrayAppend(env_);
						object.identity = existingManifest.identity;
						object.interpreter = existingManifest.interpreter;
						object.executable = existingManifest.executable;
						object.env = env;
						object.manifestArgs = existingManifest.args;
					} else {
						let executable = await manifestExecutableFromArg(file);
						let manifestInterpreter =
							await manifestInterpreterFromExecutableArg(
								file,
								object.buildToolchain,
							);
						object.executable = executable;
						if (manifestInterpreter) {
							object.interpreter = manifestInterpreter;
						}
					}
				}
			}
			if (arg.env !== undefined) {
				object.env = tg.Mutation.is(arg.env)
					? arg.env
					: await tg.Mutation.arrayAppend<std.env.Arg>(arg.env);
			}
			if (arg.identity !== undefined) {
				object.identity = arg.identity ?? "executable";
			}
			if (arg.libraryPaths !== undefined) {
				if (arg.libraryPaths !== undefined) {
					object.libraryPaths = tg.Mutation.is(arg.libraryPaths)
						? arg.libraryPaths
						: await tg.Mutation.arrayAppend(
								arg.libraryPaths.map(manifestTemplateFromArg),
						  );
				}
			}
			if (arg.interpreter !== undefined) {
				object.interpreter = arg.interpreter;
			}
			if (arg.executable !== undefined) {
				object.executable = arg.executable;
			}
			if (arg.args !== undefined) {
				object.manifestArgs = tg.Mutation.is(arg.args)
					? arg.args
					: await tg.Mutation.arrayAppend(
							(arg.args ?? []).map(manifestTemplateFromArg),
					  );
			}
			if (arg.host !== undefined) {
				object.host = arg.host;
			}

			return object;
		} else {
			return tg.unreachable();
		}
	});

	tg.assert(executable_ !== undefined, "No executable was provided.");
	let executable = await manifestExecutableFromArg(executable_);

	let identity = identity_ ?? "executable";

	let host = host_ ?? (await std.triple.host());
	std.triple.assert(host);
	let buildToolchain = buildToolchain_
		? buildToolchain_
		: std.triple.os(host) === "linux"
		  ? await gcc.toolchain({ host })
		  : await bootstrap.sdk.env(host);

	let manifestInterpreter = interpreter
		? await manifestInterpreterFromArg(interpreter, buildToolchain_)
		: undefined;

	// Ensure we're not building an identity=executable wrapper for an unwrapped statically-linked executable.
	if (
		identity === "executable" &&
		(tg.File.is(executable) || tg.Symlink.is(executable))
	) {
		let file = tg.Symlink.is(executable)
			? await executable.resolve()
			: executable;
		if (!file || tg.Directory.is(file)) {
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
		if (libraryPaths) {
			paths = paths.concat(
				await Promise.all(libraryPaths.map(manifestSymlinkFromArg)),
			);
		}
		manifestInterpreter.libraryPaths = paths;
	}

	let manifestEnv = await wrap.manifestEnvFromArg(env_);

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
		executable?: tg.File | tg.Symlink;

		/** The host system to produce a wrapper for. */
		host?: string;

		/** The identity of the executable. The default is "executable". */
		identity?: Identity;

		/** The interpreter to run the executable with. If not provided, a default is detected. */
		interpreter?: tg.File | tg.Symlink | Interpreter;

		/** Library paths to include. If the executable is wrapped, they will be merged. */
		libraryPaths?: Array<tg.Directory | tg.Symlink>;
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

	export type Manifest = {
		identity: Identity;
		interpreter?: Manifest.Interpreter;
		executable: Manifest.Executable;
		env?: Manifest.Mutation;
		args?: Array<Manifest.Template>;
	};

	export let envMapFromManifestEnv = async (
		mutation: wrap.Manifest.Mutation | undefined,
	): Promise<wrap.Manifest.EnvMap> => {
		let ret: wrap.Manifest.EnvMap = {};
		if (mutation?.kind !== "set") {
			return ret;
		}
		tg.assert(mutation.kind === "set", "Malformed env, expected set or unset.");
		return envMapFromMapValue(mutation.value);
	};

	/** Yield the key/value pairs this manifest sets once all mutations are applied. */
	export async function* envVars(
		map: wrap.Manifest.EnvMap | undefined,
	): AsyncGenerator<[string, tg.Template | undefined]> {
		if (map === undefined) {
			return;
		}
		for (let [key, mutations] of Object.entries(map)) {
			let result = undefined;
			for (let mutation of mutations ?? []) {
				if (mutation) {
					result = await mutateTemplate(result, mutation);
				}
			}
			yield [key, result];
		}
	}

	export let manifestEnvFromArg = async (
		arg: std.env.Arg,
	): Promise<wrap.Manifest.Mutation | undefined> => {
		if (arg === undefined) {
			return undefined;
		} else if (tg.Mutation.is(arg)) {
			tg.assert(
				arg.inner.kind === "unset",
				"Only unset mutations are allowed in this position.",
			);
			return { kind: "unset" };
		} else if (tg.File.is(arg)) {
			// If the arg is a file, then return the env from the file's manifest.
			let manifest = await wrap.Manifest.read(arg);
			tg.assert(manifest);
			return manifest.env;
		} else if (tg.Symlink.is(arg)) {
			// If the arg is a symlink, then return the env from the resolved file's manifest.
			let file = await arg.resolve();
			tg.assert(tg.File.is(file));
			let manifest = await wrap.Manifest.read(file);
			tg.assert(manifest);
			return manifest.env;
		} else if (tg.Directory.is(arg)) {
			// If the directory contains a file at .tangram/env, then return the env from that file's manifest.
			let envFile = await arg.tryGet(".tangram/env");
			if (envFile) {
				return manifestEnvFromArg(tg.File.expect(envFile));
			}

			// Otherwise, return an env that adds its paths to the appropriate variables.
			let ret: wrap.Manifest.EnvMap = {};
			if (await arg.tryGet("bin")) {
				pushOrSet(
					ret,
					"PATH",
					await tg.Mutation.templatePrepend(tg`${arg}/bin`, ":"),
				);
			}
			let includeDir = await arg.tryGet("include");
			if (includeDir) {
				// If the directory contains stdio.h, assume it's a system include directory and skip it.
				if (
					tg.Directory.is(includeDir) &&
					(await includeDir.tryGet("stdio.h"))
				) {
					// do nothing.
				} else {
					pushOrSet(
						ret,
						"CPATH",
						await tg.Mutation.templatePrepend(tg`${arg}/include`, ":"),
					);
				}
			}
			if (await arg.tryGet("lib")) {
				pushOrSet(
					ret,
					"LIBRARY_PATH",
					await tg.Mutation.templatePrepend(tg`${arg}/lib`, ":"),
				);
				if (await arg.tryGet("lib/pkgconfig")) {
					pushOrSet(
						ret,
						"PKG_CONFIG_PATH",
						await tg.Mutation.templatePrepend(tg`${arg}/lib/pkgconfig`, ":"),
					);
				}
			}
			return manifestMutationFromMutation(await tg.Mutation.set(ret));
		} else if (Array.isArray(arg)) {
			// If the arg is an array, then recurse.
			return mergeEnvs(...(await Promise.all(arg.map(manifestEnvFromArg))));
		} else if (typeof arg === "object") {
			// Handle an object.
			let ret: wrap.Manifest.EnvMap = Object.fromEntries(
				await Promise.all(
					Object.entries(arg).map<
						Promise<[string, Array<tg.Mutation<tg.Template.Arg>>]>
					>(async ([key, mutationArgs]) => {
						let mutations = tg.Mutation.is(mutationArgs)
							? [mutationArgs]
							: await Promise.all(
									std
										.flatten([mutationArgs])
										.filter((arg) => arg !== undefined)
										.map(normalizeEnvVarValue),
							  );
						return [key, mutations];
					}),
				),
			);
			return manifestMutationFromMutation(await tg.Mutation.set(ret));
		} else {
			return tg.unreachable();
		}
	};

	export let mergeEnvs = async (
		...envs: Array<wrap.Manifest.Mutation | undefined>
	): Promise<wrap.Manifest.Mutation | undefined> => {
		let result: wrap.Manifest.Mutation | undefined;
		for (let env of envs) {
			if (env === undefined) {
				return undefined;
			} else if (env.kind === "unset") {
				result = env;
			} else {
				tg.assert(
					env?.kind === "set",
					"Malformed env, expected set mutation but recieved " + env?.kind,
				);
				let envMap: wrap.Manifest.EnvMap = await envMapFromMapValue(env.value);
				// If the running env is a set mutation, grab the current contents.
				let map: wrap.Manifest.EnvMap = await envMapFromManifestEnv(result);
				for await (let [name, val] of Object.entries(envMap)) {
					if (val === undefined) {
						// do nothing
					} else {
						if (!(val instanceof Array)) {
							val = [val];
						}
						if (!(name in map)) {
							map[name] = [];
						}
						for (let mutation of val) {
							let lastExistingMutation = map[name]?.at(-1);
							if (lastExistingMutation) {
								// Attempt to merge the current mutation with the previous.
								let mergedMutations = await wrap.mergeMutations(
									lastExistingMutation,
									mutation,
								);

								// Replace the last mutation with the merged mutations.
								map[name] = (map[name] ?? [])
									.slice(0, -1)
									.concat(mergedMutations);
							} else {
								// Otherwise, just append the mutation.
								map[name] = (map[name] ?? []).concat([mutation]);
							}
						}
					}
				}
				result = await manifestMutationFromMutation(await tg.Mutation.set(map));
			}
		}
		return result;
	};

	/** Merge mutations if possible. By default, it will not merge template or array mutations where one is a prepend and the other is an append. Set `aggressive` to `true` to merge these cases as well. */
	export let mergeMutations = async (
		a: tg.Mutation,
		b: tg.Mutation,
		aggressive: boolean = false,
	): Promise<Array<tg.Mutation>> => {
		if (a.inner.kind === "unset" && b.inner.kind === "unset") {
			return [b];
		} else if (a.inner.kind === "unset" && b.inner.kind === "set") {
			return [b];
		} else if (a.inner.kind === "unset" && b.inner.kind === "set_if_unset") {
			let val = b.inner.value;
			return [await tg.Mutation.set<tg.Value>(val)];
		} else if (
			a.inner.kind === "unset" &&
			b.inner.kind === "template_prepend"
		) {
			return [await tg.Mutation.set(b.inner.template)];
		} else if (a.inner.kind === "unset" && b.inner.kind === "template_append") {
			return [await tg.Mutation.set(b.inner.template)];
		} else if (a.inner.kind === "unset" && b.inner.kind === "array_append") {
			return [b];
		} else if (a.inner.kind === "unset" && b.inner.kind === "array_prepend") {
			return [b];
		} else if (a.inner.kind === "set" && b.inner.kind === "unset") {
			return [b];
		} else if (a.inner.kind === "set" && b.inner.kind === "set") {
			return [b];
		} else if (a.inner.kind === "set" && b.inner.kind === "set_if_unset") {
			return [a];
		} else if (a.inner.kind === "set" && b.inner.kind === "template_prepend") {
			let setVal = a.inner.value;
			if (isTemplateArg(setVal)) {
				return [
					await tg.Mutation.set(
						tg.Template.join(
							b.inner.separator,
							b.inner.template,
							tg.template(setVal),
						),
					),
				];
			} else {
				return [a, b];
			}
		} else if (a.inner.kind === "set" && b.inner.kind === "template_append") {
			let setVal = a.inner.value;
			if (isTemplateArg(setVal)) {
				return [
					await tg.Mutation.set(
						tg.Template.join(
							b.inner.separator,
							tg.template(setVal),
							b.inner.template,
						),
					),
				];
			} else {
				return [a, b];
			}
		} else if (a.inner.kind === "set" && b.inner.kind === "array_append") {
			return [a, b];
		} else if (a.inner.kind === "set" && b.inner.kind === "array_prepend") {
			return [a, b];
		} else if (a.inner.kind === "set_if_unset" && b.inner.kind === "unset") {
			return [b];
		} else if (a.inner.kind === "set_if_unset" && b.inner.kind === "set") {
			return [b];
		} else if (
			a.inner.kind === "set_if_unset" &&
			b.inner.kind === "set_if_unset"
		) {
			return [a];
		} else if (
			a.inner.kind === "set_if_unset" &&
			b.inner.kind === "template_prepend"
		) {
			return [a, b];
		} else if (
			a.inner.kind === "set_if_unset" &&
			b.inner.kind === "template_append"
		) {
			return [a, b];
		} else if (
			a.inner.kind === "set_if_unset" &&
			b.inner.kind === "array_append"
		) {
			return [a, b];
		} else if (
			a.inner.kind === "set_if_unset" &&
			b.inner.kind === "array_prepend"
		) {
			return [a, b];
		} else if (
			a.inner.kind === "template_prepend" &&
			b.inner.kind === "unset"
		) {
			return [b];
		} else if (a.inner.kind === "template_prepend" && b.inner.kind === "set") {
			return [b];
		} else if (
			a.inner.kind === "template_prepend" &&
			b.inner.kind === "set_if_unset"
		) {
			return [a];
		} else if (
			a.inner.kind === "template_prepend" &&
			b.inner.kind === "template_prepend"
		) {
			if (a.inner.separator === b.inner.separator || aggressive) {
				return [
					await tg.Mutation.templatePrepend(
						tg.Template.join(
							a.inner.separator ?? b.inner.separator,
							b.inner.template,
							a.inner.template,
						),
					),
				];
			} else {
				return [a, b];
			}
		} else if (
			a.inner.kind === "template_prepend" &&
			b.inner.kind === "template_append"
		) {
			if (aggressive) {
				return [
					await tg.Mutation.templatePrepend(
						tg.Template.join(
							a.inner.separator ?? b.inner.separator,
							b.inner.template,
							a.inner.template,
						),
						a.inner.separator,
					),
				];
			} else {
				return [a, b];
			}
		} else if (
			a.inner.kind === "template_prepend" &&
			b.inner.kind === "array_append"
		) {
			return [a, b];
		} else if (
			a.inner.kind === "template_prepend" &&
			b.inner.kind === "array_prepend"
		) {
			return [a, b];
		} else if (a.inner.kind === "template_append" && b.inner.kind === "unset") {
			return [b];
		} else if (a.inner.kind === "template_append" && b.inner.kind === "set") {
			return [b];
		} else if (
			a.inner.kind === "template_append" &&
			b.inner.kind === "set_if_unset"
		) {
			return [a];
		} else if (
			a.inner.kind === "template_append" &&
			b.inner.kind === "template_prepend"
		) {
			if (aggressive) {
				return [
					await tg.Mutation.templateAppend(
						tg.Template.join(
							b.inner.separator ?? a.inner.separator,
							b.inner.template,
							a.inner.template,
						),
						a.inner.separator,
					),
				];
			} else {
				return [a, b];
			}
		} else if (
			a.inner.kind === "template_append" &&
			b.inner.kind === "template_append"
		) {
			if (a.inner.separator === b.inner.separator || aggressive) {
				return [
					await tg.Mutation.templateAppend(
						tg.Template.join(
							a.inner.separator ?? b.inner.separator,
							a.inner.template,
							b.inner.template,
						),
					),
				];
			} else {
				return [a, b];
			}
		} else if (
			a.inner.kind === "template_append" &&
			b.inner.kind === "array_append"
		) {
			return [a, b];
		} else if (
			a.inner.kind === "template_append" &&
			b.inner.kind === "array_prepend"
		) {
			return [a, b];
		} else if (a.inner.kind === "array_append" && b.inner.kind === "unset") {
			return [b];
		} else if (a.inner.kind === "array_append" && b.inner.kind === "set") {
			return [b];
		} else if (
			a.inner.kind === "array_append" &&
			b.inner.kind === "set_if_unset"
		) {
			return [a];
		} else if (
			a.inner.kind === "array_append" &&
			b.inner.kind === "array_append"
		) {
			return [
				await tg.Mutation.arrayAppend<tg.Value>(
					a.inner.values.concat(b.inner.values),
				),
			];
		} else if (
			a.inner.kind === "array_append" &&
			b.inner.kind === "array_prepend"
		) {
			if (aggressive) {
				return [
					await tg.Mutation.arrayAppend<tg.Value>(
						b.inner.values.concat(a.inner.values),
					),
				];
			} else {
				return [a, b];
			}
		} else if (
			a.inner.kind === "array_append" &&
			b.inner.kind === "template_append"
		) {
			return [a, b];
		} else if (
			a.inner.kind === "array_append" &&
			b.inner.kind === "template_prepend"
		) {
			return [a, b];
		} else if (a.inner.kind === "array_prepend" && b.inner.kind === "unset") {
			return [b];
		} else if (a.inner.kind === "array_prepend" && b.inner.kind === "set") {
			return [b];
		} else if (
			a.inner.kind === "array_prepend" &&
			b.inner.kind === "set_if_unset"
		) {
			return [a];
		} else if (
			a.inner.kind === "array_prepend" &&
			b.inner.kind === "array_append"
		) {
			if (aggressive) {
				return [
					await tg.Mutation.arrayPrepend<tg.Value>(
						a.inner.values.concat(b.inner.values),
					),
				];
			} else {
				return [a, b];
			}
		} else if (
			a.inner.kind === "array_prepend" &&
			b.inner.kind === "array_prepend"
		) {
			return [
				await tg.Mutation.arrayPrepend<tg.Value>(
					b.inner.values.concat(a.inner.values),
				),
			];
		} else if (
			a.inner.kind === "array_prepend" &&
			b.inner.kind === "template_append"
		) {
			return [a, b];
		} else if (
			a.inner.kind === "array_prepend" &&
			b.inner.kind === "template_prepend"
		) {
			return [a, b];
		} else {
			return tg.unreachable();
		}
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
			if (tg.File.is(resolved)) {
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
			args?: Array<Manifest.Template>;
		};

		export type LdLinuxInterpreter = {
			kind: "ld-linux";
			path: Manifest.Symlink;
			libraryPaths?: Array<Manifest.Symlink>;
			preloads?: Array<Manifest.Symlink>;
			args?: Array<Manifest.Template>;
		};

		export type LdMuslInterpreter = {
			kind: "ld-musl";
			path: Manifest.Symlink;
			libraryPaths?: Array<Manifest.Symlink>;
			preloads?: Array<Manifest.Symlink>;
			args?: Array<Manifest.Template>;
		};

		export type DyLdInterpreter = {
			kind: "dyld";
			libraryPaths?: Array<Manifest.Symlink>;
			preloads?: Array<Manifest.Symlink>;
		};

		export type Executable =
			| { kind: "path"; value: Manifest.Symlink }
			| { kind: "content"; value: Manifest.Template };

		export type Symlink = {
			artifact?: tg.Artifact.Id;
			path?: string;
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
					kind: "template_prepend";
					template: Manifest.Template;
					separator?: string;
			  }
			| {
					kind: "template_append";
					template: Manifest.Template;
					separator?: string;
			  }
			| { kind: "array_prepend"; values: Array<Manifest.Value> }
			| { kind: "array_append"; values: Array<Manifest.Value> };

		// Matches tg::value::Data
		export type Value =
			| { kind: "null" }
			| { kind: "bool"; value: boolean }
			| { kind: "number"; value: number }
			| { kind: "string"; value: string }
			| { kind: "directory"; value: tg.Directory.Id }
			| { kind: "file"; value: tg.File.Id }
			| { kind: "symlink"; value: tg.Symlink.Id }
			| { kind: "template"; value: Manifest.Template }
			| { kind: "mutation"; value: Manifest.Mutation }
			| { kind: "map"; value: { [key: string]: Manifest.Value } }
			| Array<Manifest.Value>;

		// The non-serializeable type of a normalized env.
		export type Env = tg.Mutation<EnvMap>;
		export type EnvMap = Record<
			string,
			Array<tg.Mutation<tg.Template.Arg>> | undefined
		>;

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
			let references = [...references_].map((id) => tg.Artifact.withId(id));

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
		!(tg.File.is(arg) || tg.Symlink.is(arg) || tg.Template.is(arg))
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
	} else if (tg.File.is(arg) || tg.Symlink.is(arg)) {
		let value = await manifestSymlinkFromArg(arg);
		tg.assert(value);
		return {
			kind: "path",
			value,
		};
	} else if (typeof arg === "string" || tg.Template.is(arg)) {
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
	if (tg.File.is(arg) || tg.Symlink.is(arg)) {
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
		let interpreterFile = tg.Symlink.is(arg.executable)
			? await arg.executable.resolve()
			: arg.executable;
		if (!interpreterFile || tg.Directory.is(interpreterFile)) {
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
		let interpreterFile = tg.Symlink.is(arg.executable)
			? await arg.executable.resolve()
			: arg.executable;
		if (!interpreterFile || tg.Directory.is(interpreterFile)) {
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
			: gcc.toolchain({ host });
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
			arg.kind === "dyld")
	);
};

let manifestInterpreterFromExecutableArg = async (
	arg: tg.File | tg.Symlink,
	buildToolchainArg?: std.env.Arg,
): Promise<wrap.Manifest.Interpreter | undefined> => {
	// Resolve the arg to a file if it is a symlink.
	if (tg.Symlink.is(arg)) {
		let resolvedArg = await arg.resolve();
		tg.assert(tg.File.is(resolvedArg));
		arg = resolvedArg;
	}

	// Get the file's executable metadata.
	let metadata = await std.file.executableMetadata(arg);

	// Handle the executable by its format.
	switch (metadata.format) {
		case "elf": {
			return manifestInterpreterFromElf(metadata);
		}
		case "mach-o": {
			let arch = metadata.arches[0];
			tg.assert(arch);
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
	// FIXME - can we make this better, and prefer the host toolchain if it's available? Tricky when bootstrapping.
	// This function should probably also get buildToolchain threaded through.
	let buildToolchain =
		libc === "musl" ? bootstrap.sdk.env(host) : gcc.toolchain({ host });

	// Obtain injection library.
	let injectionLib = await injection.default({ buildToolchain, host });

	// Handle each interpreter type.
	if (metadata.interpreter?.includes("ld-linux")) {
		// Handle an ld-linux interpreter.
		let toolchainDir = await gcc.toolchain({ host });
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
			return tg.symlink({ artifact, path: symlink.path });
		}
		return tg.symlink({ artifact });
	} else if (symlink.path) {
		return tg.symlink({ path: symlink.path });
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
	} else if (typeof arg === "string" || tg.Template.is(arg)) {
		return manifestSymlinkFromArg(await tg.symlink(arg));
	} else if (tg.Symlink.is(arg)) {
		return {
			artifact: await (await arg.artifact())?.id(),
			path: await arg.path(),
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
		typeof value === "string" || tg.Artifact.is(value) || tg.Template.is(value)
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
	} else if (mutation.inner.kind === "template_prepend") {
		let template = mutation.inner.template;
		tg.assert(
			valueIsTemplateLike(template),
			`Expected a template arg, but got ${JSON.stringify(template)}.`,
		);
		return {
			kind: "template_prepend",
			template: await manifestTemplateFromArg(template),
			separator: mutation.inner.separator ?? ":",
		};
	} else if (mutation.inner.kind === "template_append") {
		let template = mutation.inner.template;
		tg.assert(
			valueIsTemplateLike(template),
			`Expected a template arg, but got ${JSON.stringify(template)}.`,
		);
		return {
			kind: "template_append",
			template: await manifestTemplateFromArg(template),
			separator: mutation.inner.separator ?? ":",
		};
	} else if (mutation.inner.kind === "array_prepend") {
		tg.assert(mutation.inner.values.every(valueIsTemplateLike));
		let values = await Promise.all(
			mutation.inner.values.map(async (arg) =>
				manifestValueFromManifestTemplate(await manifestTemplateFromArg(arg)),
			),
		);
		return { kind: "array_prepend", values };
	} else if (mutation.inner.kind === "array_append") {
		tg.assert(mutation.inner.values.every(valueIsTemplateLike));
		let values = await Promise.all(
			mutation.inner.values.map(async (arg) =>
				manifestValueFromManifestTemplate(await manifestTemplateFromArg(arg)),
			),
		);
		return { kind: "array_append", values };
	} else {
		return tg.unreachable();
	}
};

let normalizeEnvVarValue = async (value: unknown): Promise<tg.Mutation> => {
	if (value === undefined) {
		return tg.Mutation.arrayAppend(tg``);
	} else if (tg.Mutation.is(value)) {
		return value;
	} else if (isTemplateArg(value)) {
		return tg.Mutation.set(tg.template(value));
	} else if (typeof value === "boolean" || typeof value === "number") {
		return tg.Mutation.set(tg.template(value.toString()));
	} else {
		throw new Error("Unexpected value type: " + value);
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

let mutateTemplate = async (
	template: tg.Template | undefined,
	mutation: tg.Mutation<tg.Template.Arg>,
): Promise<tg.Template | undefined> => {
	if (
		mutation.inner.kind === "array_append" ||
		mutation.inner.kind === "array_prepend"
	) {
		throw new Error("Cannot apply an array mutation to a template");
	} else if (mutation.inner.kind === "template_append") {
		return tg.Template.join(
			mutation.inner.separator,
			template,
			mutation.inner.template,
		);
	} else if (mutation.inner.kind === "template_prepend") {
		return tg.Template.join(
			mutation.inner.separator,
			mutation.inner.template,
			template,
		);
	} else if (mutation.inner.kind === "set") {
		tg.assert(isTemplateArg(mutation.inner.value));
		return tg.template(mutation.inner.value);
	} else if (mutation.inner.kind === "set_if_unset") {
		if (template?.components.length === 0) {
			tg.assert(isTemplateArg(mutation.inner.value));
			return tg.template(mutation.inner.value);
		} else {
			return template;
		}
	} else if (mutation.inner.kind === "unset") {
		return tg.template();
	}
	return tg.unreachable();
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
	} else if (manifestMutation.kind === "array_prepend") {
		return tg.Mutation.arrayAppend(
			manifestMutation.values.map(valueFromManifestValue),
		);
	} else if (manifestMutation.kind === "array_append") {
		return tg.Mutation.arrayAppend(
			manifestMutation.values.map(valueFromManifestValue),
		);
	} else if (manifestMutation.kind === "template_prepend") {
		return tg.Mutation.templatePrepend(
			templateFromManifestTemplate(manifestMutation.template),
			manifestMutation.separator,
		);
	} else if (manifestMutation.kind === "template_append") {
		return tg.Mutation.templateAppend(
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
		return { kind: "null" };
	} else if (typeof value === "boolean") {
		return { kind: "bool", value };
	} else if (typeof value === "number") {
		return { kind: "number", value };
	} else if (typeof value === "string") {
		return { kind: "string", value };
	} else if (tg.Directory.is(value)) {
		return { kind: "directory", value: await value.id() };
	} else if (tg.File.is(value)) {
		return { kind: "file", value: await value.id() };
	} else if (tg.Symlink.is(value)) {
		return { kind: "symlink", value: await value.id() };
	} else if (tg.Template.is(value)) {
		return { kind: "template", value: await manifestTemplateFromArg(value) };
	} else if (tg.Mutation.is(value)) {
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
	} else if (value.kind === "null") {
		undefined;
	} else if (value.kind === "bool") {
		return value.value;
	} else if (value.kind === "number") {
		return value.value;
	} else if (value.kind === "string") {
		return value.value;
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
	yield* wrap.envVars(await wrap.envMapFromManifestEnv(manifest.env));
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

let envMapFromMapValue = async (
	value: wrap.Manifest.Value,
): Promise<wrap.Manifest.EnvMap> => {
	tg.assert(
		!(value instanceof Array) && value.kind === "map",
		"Malformed env, expected a map of mutations.",
	);
	let ret: wrap.Manifest.EnvMap = {};
	for (let [key, val] of Object.entries(value.value)) {
		if (val instanceof Array) {
			ret[key] = await Promise.all(
				val.map(async (inner) => {
					let val = await valueFromManifestValue(inner);
					tg.assert(tg.Mutation.is(val), "Malformed env, expected a mutation.");
					return val;
				}),
			);
		} else if (val.kind === "mutation") {
			ret[key] = [await mutationFromManifestMutation(val.value)];
		} else {
			throw new Error(
				"Malformed env, expected a mutation or array of mutations.",
			);
		}
	}
	return ret;
};

let isTemplateArg = (arg: unknown): arg is tg.Template.Arg => {
	return typeof arg === "string" || tg.Artifact.is(arg) || tg.Template.is(arg);
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

let manifestTemplateIsSymlink = (template: wrap.Manifest.Template) => {
	let components = template.components;
	if (components.length === 1) {
		return components[0]?.kind === "artifact";
	} else if (components.length === 2) {
		return (
			components[0]?.kind === "artifact" && components[1]?.kind === "string"
		);
	} else {
		return false;
	}
};

let maybeSymlinkFromManifestTemplate = async (
	template: wrap.Manifest.Template,
): Promise<tg.Symlink | undefined> => {
	if (manifestTemplateIsSymlink(template)) {
		let artifactId = template.components[0]?.value;
		if (!artifactId) {
			return undefined;
		}
		let artifact = tg.Artifact.withId(artifactId);
		let path = template.components[1]?.value.replace(":", "").substring(1);
		return tg.symlink({ artifact, path });
	} else {
		return undefined;
	}
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
		case "template_prepend":
		case "template_append":
			yield* manifestTemplateReferences(mutation.template);
			break;
		case "array_prepend":
		case "array_append":
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
	if (tg.File.is(artifact)) {
		yield* fileReferences(artifact);
	} else if (tg.Directory.is(artifact)) {
		yield* directoryReferences(artifact);
	} else if (tg.Symlink.is(artifact)) {
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
	if (await symlink.artifact()) {
		let artifact = await symlink.resolve();
		if (artifact) {
			yield* artifactReferences(artifact);
		}
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
	} else if (value.kind === "directory") {
		yield tg.Artifact.withId(value.value);
	} else if (value.kind === "file") {
		yield tg.Artifact.withId(value.value);
	} else if (value.kind === "symlink") {
		yield tg.Artifact.withId(value.value);
	} else if (value.kind === "template") {
		yield* manifestTemplateReferences(value.value);
	} else if (value.kind === "mutation") {
		yield* manifestMutationReferences(value.value);
	} else if (value.kind === "map") {
		for (let v of Object.values(value.value)) {
			yield* manifestValueReferences(v);
		}
	}
}

export let artifactId = (artifact: tg.Artifact): Promise<tg.Artifact.Id> => {
	if (tg.Directory.is(artifact)) {
		return artifact.id();
	} else if (tg.File.is(artifact)) {
		return artifact.id();
	} else if (tg.Symlink.is(artifact)) {
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
	let programSource = await tg.file(`
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>

extern char **environ;

int main(int argc, char *argv[]) {
		char path[1024];
		ssize_t len = readlink("/proc/self/exe", path, sizeof(path) - 1);
		if (len == -1) {
			perror("readlink");
			return EXIT_FAILURE;
		}
		path[len] = '\\0';
		printf("/proc/self/exe: %s\\n\\n", path);

    printf("Command line arguments:\\n");
    for (int i = 0; i < argc; i++) {
        printf("argv[%d]: %s\\n", i, argv[i]);
    }

    printf("\\nEnvironment variables:\\n");
    for (char **env = environ; *env != NULL; env++) {
        printf("%s\\n", *env);
    }

    return EXIT_SUCCESS;
}`);

	let toolchain = await bootstrap.toolchain();
	let utils = await bootstrap.utils();

	return tg.File.expect(
		await tg.build(tg`cc -xc ${programSource} -o $OUTPUT`, {
			env: { PATH: tg`${toolchain}/bin:${utils}/bin` },
		}),
	);
});

export let testSingleArgObjectNoMutations = tg.target(async () => {
	let executable = await argAndEnvDump();
	let executableID = await executable.id();

	let buildToolchain = await bootstrap.sdk();

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
