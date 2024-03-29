import * as std from "./tangram.tg.ts";
import { gnuEnv } from "./utils/coreutils.tg.ts";
import { wrap } from "./wrap.tg.ts";

export async function env(...args: tg.Args<env.Arg>) {
	// Check if any arg sets bootstrapMode. If so, omit the std utils.
	type Apply = {
		bootstrapMode: boolean;
		wrapEnv: Array<env.Arg>;
	};
	let { bootstrapMode: bootstrapMode_, wrapEnv: wrapEnv_ } =
		await tg.Args.apply<env.Arg, Apply>(args, async (arg) => {
			if (isBootstrapModeArg(arg)) {
				let { bootstrapMode } = arg;
				return { bootstrapMode };
			} else {
				let ret: tg.MutationMap<Apply> = {};
				if (arg !== undefined) {
					if (tg.Mutation.is(arg)) {
						ret.wrapEnv = arg;
					} else {
						ret.wrapEnv = await tg.Mutation.arrayAppend<env.Arg>(arg);
					}
				}
				return ret;
			}
		});
	let bootstrapMode = bootstrapMode_ ?? false;
	let wrapEnv = wrapEnv_ ?? [];

	// Include the standard utils unless bootstrap mode is set.
	let buildToolchain = undefined;
	if (!bootstrapMode) {
		wrapEnv.push(await std.utils.env());
	} else {
		buildToolchain = await std.sdk({ bootstrapMode });
	}

	return std.wrap(gnuEnv(), {
		buildToolchain,
		env: wrapEnv,
	});
}

export namespace env {
	export type Arg =
		| undefined
		| tg.Artifact
		| { bootstrapMode: boolean }
		| tg.MaybeMutation<ArgObject>
		| Array<Arg>;

	export type ArgObject = tg.MutationMap<
		Record<
			string,
			tg.MaybeNestedArray<tg.MaybeMutation<tg.Template.Arg | boolean>>
		>
	>;

	export type EnvObject = tg.MutationMap<Record<string, tg.Template.Arg>>;

	/** Take an `env.Arg` to a `tg.target`-friendly mutation map, additionally applying all mutations in each variable. */
	export let object = async (
		...args: tg.Args<Arg>
	): Promise<tg.MaybeMutation<env.EnvObject> | undefined> => {
		type Apply = {
			env: Array<env.Arg>;
		};
		let { env: env_ } = await tg.Args.apply<env.Arg, Apply>(
			args,
			async (arg) => {
				if (arg === undefined || isBootstrapModeArg(arg)) {
					return {};
				} else if (tg.Mutation.is(arg)) {
					return { env: arg };
				} else {
					return { env: await tg.Mutation.arrayAppend<env.Arg>(arg) };
				}
			},
		);

		let env = await wrap.manifestEnvFromArg(env_);
		if (env === undefined) {
			return undefined;
		} else if (env.kind === "unset") {
			return tg.Mutation.unset();
		} else {
			let map = await wrap.envMapFromManifestEnv(env);
			let normalized = await normalizeEnvMap(map);
			return normalized;
		}
	};

	/////// Queries

	type BinsInPathArg = {
		env: env.Arg;
		predicate?: (name: string) => boolean;
	};

	/** Yield each binary in PATH with a name optionally matching a predicate, iterating alphabetically through each directory in descending order of precedence.. */
	export async function* binsInPath(
		arg: BinsInPathArg,
	): AsyncGenerator<[string, tg.File | tg.Symlink]> {
		let { env, predicate } = arg;
		// If no predicate was provided, use a default one that matches everything.
		if (!predicate) {
			predicate = (_arg) => true;
		}

		for await (let [_, dir] of dirsInVar({ env, key: "PATH" })) {
			for await (let [name, artifact] of dir) {
				if (
					predicate(name) &&
					(tg.File.is(artifact) || tg.Symlink.is(artifact))
				) {
					if (tg.Symlink.is(artifact)) {
						artifact = await tg.symlink({
							artifact: dir,
							path: artifact.path(),
						});
					}
					yield [name, artifact];
				}
			}
		}
	}

	type DirsInVarArg = {
		env: env.Arg;
		key: string;
		separator?: string;
	};

	/** Yield each directory in a colon-separated template from a specific env var. Returns [parentDir, dir], as often the parent is what you're looking for. */
	export async function* dirsInVar(
		arg: DirsInVarArg,
	): AsyncGenerator<[tg.Directory, tg.Directory]> {
		let { env, key, separator = ":" } = arg;
		let value = await tryGetKey({ env, key });
		if (!value) {
			return;
		}

		for (let chunk of separateTemplate(value, separator)) {
			let [directory, subpath] = chunk;
			// If this chunk represents a real tg.Directory, iterate through it looking for matches.
			if (
				directory &&
				typeof directory !== "string" &&
				tg.Directory.is(directory) &&
				subpath &&
				typeof subpath === "string"
			) {
				// Slice off the leading `/`.
				let subdir = await directory.get(subpath.slice(1));
				if (tg.Directory.is(subdir)) {
					yield [directory, subdir];
				}
			}
		}
	}

	type ArtifactByKeyArg = {
		env: env.Arg;
		key: string;
	};

	/** Retrieve the artifact a key's template value refers to. Throws if cannot be found. */
	export let getArtifactByKey = async (
		arg: ArtifactByKeyArg,
	): Promise<tg.Artifact> => {
		let template = await tryGetKey(arg);
		tg.assert(template, `Unable to find key ${arg.key} in this env.`);
		// There are two options. Either the template points directly to an artifact with a single reference, or it points to a directory with a subpath. Anything else, we reject.
		let components = template.components;
		switch (components.length) {
			case 1: {
				let [artifact] = components;
				if (artifact && typeof artifact !== "string") {
					return artifact;
				}
			}
			case 2: {
				let [directory, subpath] = components;
				if (
					directory &&
					typeof directory !== "string" &&
					tg.Directory.is(directory) &&
					subpath &&
					typeof subpath === "string"
				) {
					// Slice off the leading `/`.
					return await directory.get(subpath.slice(1));
				}
			}
			default: {
				throw new Error(
					`Could not resolve artifact from key ${arg.key}. Value: ${template}.`,
				);
			}
		}
	};

	/** Retrieve the artifact a key's template value refers to. Returns undefined if cannot be found. */
	export let tryGetArtifactByKey = async (
		arg: ArtifactByKeyArg,
	): Promise<tg.Artifact | undefined> => {
		let template = await tryGetKey(arg);
		if (!template) {
			return undefined;
		}
		// There are two options. Either the template points directly to an artifact with a single reference, or it points to a directory with a subpath. Anything else, we reject.
		let components = template.components;
		switch (components.length) {
			case 1: {
				let [artifact] = components;
				if (artifact && typeof artifact !== "string") {
					return artifact;
				}
			}
			case 2: {
				let [directory, subpath] = components;
				if (
					directory &&
					typeof directory !== "string" &&
					tg.Directory.is(directory) &&
					subpath &&
					typeof subpath === "string"
				) {
					// Slice off the leading `/`.
					return await directory.get(subpath.slice(1));
				}
			}
			default: {
				return undefined;
			}
		}
	};

	type GetKeyArg = {
		env: env.Arg;
		key: string;
	};

	/** Retrieve the value of a key. If not present, throw an error. */
	export let getKey = async (arg: GetKeyArg): Promise<tg.Template> => {
		let { env, key } = arg;
		let manifest = await wrap.manifestEnvFromArg(env);
		if (!manifest) {
			throw new Error(`This env does not provide a manifest.`);
		}
		let map = await wrap.envMapFromManifestEnv(manifest);
		for await (let [foundKey, value] of wrap.envVars(map)) {
			if (foundKey === key) {
				tg.assert(value, `Found key ${key} but it was undefined.`);
				return value;
			}
		}
		throw new Error(`Could not find key ${key} in this env.`);
	};

	/** Retrieve the value of a key. If not present, return `undefined`. */
	export async function tryGetKey(
		arg: GetKeyArg,
	): Promise<tg.Template | undefined> {
		let { env, key } = arg;
		let manifest = await wrap.manifestEnvFromArg(env);
		if (!manifest) {
			return undefined;
		}
		let map = await wrap.envMapFromManifestEnv(manifest);
		for await (let [foundKey, value] of wrap.envVars(map)) {
			if (foundKey === key) {
				return value;
			}
		}
		return undefined;
	}

	/** Yield all the environment set in the manifest. */
	export async function* envVars(
		envArg: env.Arg,
	): AsyncGenerator<[string, tg.Template | undefined]> {
		let manifest = await wrap.manifestEnvFromArg(envArg);
		if (!manifest) {
			return undefined;
		}
		let map = await wrap.envMapFromManifestEnv(manifest);
		for await (let [key, value] of wrap.envVars(map)) {
			yield [key, value];
		}
	}

	/** Return the value of `SHELL` if present. If not present, return the file providing `sh` in `PATH`. If not present, throw an error. */
	export let getShellExecutable = async (
		envArg: env.Arg,
	): Promise<tg.File | tg.Symlink> => {
		// First, check if "SHELL" is set and points to an executable.
		let shellArtifact = await env.tryGetArtifactByKey({
			env: envArg,
			key: "SHELL",
		});
		if (shellArtifact) {
			tg.assert(
				tg.File.is(shellArtifact) || tg.Symlink.is(shellArtifact),
				`Template for shell did not point to a file or symlink.`,
			);
			return shellArtifact;
		}

		// If SHELL isn't set, see if `sh` is in path. Return that file if so.
		let shExecutable = await tryWhich({ env: envArg, name: "sh" });
		if (shExecutable) {
			return shExecutable;
		}

		// If not, we failed to find a shell.
		throw new Error(`This env does not provide a shell.`);
	};

	/** Return the value of `SHELL` if present. If not present, return the file providing `sh` in `PATH`. If not present, return `undefined`. */
	export let tryGetShellExecutable = async (
		envArg: env.Arg,
	): Promise<tg.File | tg.Symlink | undefined> => {
		// First, check if "SHELL" is set and points to an executable.
		let shellArtifact = await tryGetArtifactByKey({
			env: envArg,
			key: "SHELL",
		});
		if (shellArtifact) {
			tg.assert(
				tg.File.is(shellArtifact) || tg.Symlink.is(shellArtifact),
				`Template for shell did not point to a file or symlink.`,
			);
			return shellArtifact;
		}

		// If SHELL isn't set, see if `sh` is in path. Return that file if so.
		let shExecutable = await tryWhich({ env: envArg, name: "sh" });
		if (shExecutable) {
			return shExecutable;
		}

		// If not, we failed to find a shell.
		return undefined;
	};

	type ProvidesArg = {
		env: env.Arg;
		name?: string;
		names?: Array<string>;
	};

	/** Assert the env provides a specific executable in PATH. */
	export let assertProvides = async (arg: ProvidesArg) => {
		let { name, names: names_ } = arg;
		let names = names_ ?? [];
		if (name) {
			names.push(name);
		}

		await Promise.all(
			names.map(async (name) => {
				for await (let [binName, _file] of env.binsInPath(arg)) {
					if (binName === name) {
						return true;
					}
				}
				throw new Error(`Error: could not find ${name}`);
			}),
		);
		return true;
	};

	/** Check if the env provides a specific executable in PATH. */
	export let provides = async (arg: ProvidesArg): Promise<boolean> => {
		let { name, names: names_ } = arg;
		let names = names_ ?? [];
		if (name) {
			names.push(name);
		}

		let results = await Promise.all(
			names.map(async (name) => {
				for await (let [binName, _file] of env.binsInPath(arg)) {
					if (binName === name) {
						return true;
					}
				}
				return false;
			}),
		);
		return results.every((el) => el);
	};
	type WhichArg = {
		env: env.Arg;
		name: string;
	};

	/** Return the file for a given executable in an env's PATH. Throws an error if not present. */
	export let which = async (arg: WhichArg): Promise<tg.File | tg.Symlink> => {
		let file = await tryWhich(arg);
		tg.assert(file, `This env does not provide ${arg.name} in $PATH`);
		return file;
	};

	/** Return the artifact providing a given binary by name. */
	export let whichArtifact = async (
		arg: WhichArg,
	): Promise<tg.Directory | undefined> => {
		for await (let [parentDir, binDir] of env.dirsInVar({
			env: arg.env,
			key: "PATH",
		})) {
			let artifact = await binDir.tryGet(arg.name);
			if (artifact) {
				return parentDir;
			}
		}
	};

	/** Return the file for a given executable in an env's PATH. Returns undefined if not present. */
	export let tryWhich = async (
		arg: WhichArg,
	): Promise<tg.File | tg.Symlink | undefined> => {
		for await (let [name, executable] of env.binsInPath(arg)) {
			if (name === arg.name) {
				if (tg.Symlink.is(executable) || tg.File.is(executable)) {
					return executable;
				}
			}
		}
		return undefined;
	};
}

let isBootstrapModeArg = (arg: unknown): arg is { bootstrapMode: boolean } => {
	return (
		arg !== undefined &&
		arg !== null &&
		typeof arg === "object" &&
		"bootstrapMode" in arg
	);
};

/** The wrapper can handle arrays of mutations for each key, but we need just a single mutation for each key to pass to `tg.target`. However, we don't want to render to templates completely and lose any mutation information. This utility produces an object where each key has a single mutation. */
let normalizeEnvMap = async (
	envMap: wrap.Manifest.EnvMap,
): Promise<env.EnvObject> => {
	let map: Record<string, Array<tg.Mutation<tg.Template.Arg> | undefined>> = {};

	// Merge mutations for each key, retaining the array.
	for (let [key, value] of Object.entries(envMap)) {
		if (value === undefined) {
			map[key] = [tg.Mutation.unset()];
		} else {
			if (value.length === 1) {
				// If the array has a single element, just use that.
				let mutation = value[0];
				if (!tg.Mutation.is(mutation)) {
					mutation = await tg.Mutation.set<tg.Template.Arg>(mutation);
				}
				map[key] = [mutation];
			} else {
				// Otherwise we need to merge mutations until there is just one left.

				for (let mutation of value) {
					let lastExistingMutation = map[key]?.at(-1);
					if (lastExistingMutation) {
						if (!tg.Mutation.is(lastExistingMutation)) {
							lastExistingMutation =
								await tg.Mutation.set<tg.Template.Arg>(lastExistingMutation);
						}
						// Attempt to merge the current mutation with the previous.
						let mergedMutations = await wrap.mergeMutations(
							lastExistingMutation,
							mutation,
							true,
						);

						// Replace the last mutation with the merged mutations.
						map[key] = (map[key] ?? []).slice(0, -1).concat(mergedMutations);
					} else {
						// Otherwise, just append the mutation.
						if (!tg.Mutation.is(mutation)) {
							mutation = await tg.Mutation.set<tg.Template.Arg>(mutation);
						}
						map[key] = (map[key] ?? []).concat([mutation]);
					}
				}
			}
		}
	}

	// Ensure each key has exactly one member in the array and produce the final object.
	let ret: env.EnvObject = {};
	for (let [key, mutations] of Object.entries(map)) {
		tg.assert(
			mutations.length === 1,
			`Expected exactly one mutation for ${key}`,
		);
		let mutation = mutations[0];
		if (mutation) {
			ret[key] = mutation;
		}
	}
	return ret;
};

function* separateTemplate(
	template: tg.Template,
	separator: string,
): Generator<Array<tg.Template.Component>> {
	let chunk: Array<tg.Template.Component> = [];
	for (let component of template.components) {
		if (typeof component === "string" && component.endsWith(separator)) {
			let completeChunk = [...chunk, component.slice(0, -1)];
			chunk = [];
			yield completeChunk;
		} else {
			chunk.push(component);
		}
	}
	yield chunk;
}
