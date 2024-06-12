import * as bootstrap from "./bootstrap.tg.ts";
import * as std from "./tangram.tg.ts";
import { gnuEnv } from "./utils/coreutils.tg.ts";
import { wrap } from "./wrap.tg.ts";

export async function env(...args: std.args.UnresolvedArgs<env.Arg>) {
	return await env.target(...args);
}

export namespace env {
	export type Arg =
		| undefined
		| tg.Artifact
		| UtilsToggle
		| tg.MaybeMutation<ArgObject>;

	/** An object containing values or potentially nested mutations. */
	export type ArgObject = std.args.MaybeMutationMap<
		Record<
			string,
			tg.MaybeNestedArray<tg.MaybeMutation<tg.Template.Arg | boolean>>
		>
	>;

	/** An object containing values or mutations for a set of environment variables, ready to pass to `tg.target`. */
	export type EnvObject = std.args.MaybeMutationMap<
		Record<string, tg.Template.Arg>
	>;

	/** An object containing only a `utils` boolean field and no other members. */
	export type UtilsToggle = { utils: boolean } & Record<string, never>;

	export let target = tg.target(async (...args: std.Args<Arg>) => {
		// Check if the user requested to omit the standard utils.
		let utils = args.reduce((acc, arg) => {
			if (isUtilsToggle(arg)) {
				if (arg.utils === false) {
					return false;
				}
			}
			return acc;
		}, true);
		let objectArgs = std.flatten(args.filter((arg) => !isUtilsToggle(arg)));

		// If utils is set to true, add the standard utils. If false, pass the bootstrap-only toolchain to std.wrap.
		let buildToolchain = undefined;
		if (utils) {
			objectArgs.push(await std.utils.env());
		} else {
			buildToolchain = await bootstrap.sdk();
		}

		return std.wrap(gnuEnv(), {
			buildToolchain,
			env: std.env.arg(objectArgs),
		});
	});

	/** Produce a single env object from a potentially nested array of env args. */
	export let arg = async (
		...args: std.args.UnresolvedArgs<Arg>
	): Promise<std.env.EnvObject> => {
		let envObjects = await Promise.all(
			std
				.flatten(await Promise.all(args.map(tg.resolve)))
				.filter((arg) => arg !== undefined && !isUtilsToggle(arg))
				.map(async (arg) => {
					if (tg.Artifact.is(arg)) {
						return await env.envObjectFromArtifact(arg);
					} else {
						tg.assert(arg !== undefined);
						return arg;
					}
				}),
		);
		return await env.mergeArgObjects(...envObjects);
	};

	/** Produce an env object from an artifact value. */
	export let envObjectFromArtifact = async (
		artifact: tg.Artifact,
	): Promise<env.ArgObject> => {
		if (artifact instanceof tg.File) {
			// Attempt to read the manifest from the file.
			let manifest = await std.wrap.Manifest.read(artifact);
			if (!manifest) {
				// If the file was not a wrapper, throw an error.
				throw new Error(`Could not read manifest from ${artifact}`);
			}
			// If the file was a wrapper, return its env.
			return await wrap.envArgFromManifestEnv(manifest.env);
		} else if (artifact instanceof tg.Directory) {
			// If the directory contains a file at `.tangram/env`, return the env from that file's manifest.
			let envFile = await artifact.tryGet(".tangram/env");
			if (envFile) {
				tg.File.assert(envFile);
				return await envObjectFromArtifact(envFile);
			}

			// Otherwise, return an env with PATH/CPATH/LIBRARY_PATH according to the contents of the directory.
			let env: env.EnvObject = {};
			if (await artifact.tryGet("bin")) {
				env["PATH"] = await tg.Mutation.prefix(tg`${artifact}/bin`, ":");
			}
			let includeDir = await artifact.tryGet("include");
			if (includeDir) {
				if (
					includeDir instanceof tg.Directory &&
					(await includeDir.tryGet("stdio.h"))
				) {
					// This is a toolchain system include path. Do nothing - the toolchain will handle it.
				} else {
					env["CPATH"] = await tg.Mutation.prefix(tg`${artifact}/include`, ":");
				}
			}
			if (await artifact.tryGet("lib")) {
				env["LIBRARY_PATH"] = await tg.Mutation.prefix(
					tg`${artifact}/lib`,
					":",
				);
			}
			return env;
		} else if (artifact instanceof tg.Symlink) {
			// Resolve the symlink and try again.
			let resolved = await artifact.resolve();
			if (resolved === undefined) {
				throw new Error(`Could not resolve symlink ${artifact}`);
			} else {
				return await env.envObjectFromArtifact(resolved);
			}
		} else {
			return tg.unreachable("unrecognized artifact type");
		}
	};

	/** Merge a list of `env.ArgObject` values into a single `env.EnvObject`, normalizing all mutations to a single mutation per key. */
	export let mergeArgObjects = async (
		...argObjects: Array<tg.MaybeMutation<env.ArgObject>>
	): Promise<env.EnvObject> => {
		// Keep a running map of the final env object.
		let result: env.EnvObject = {};
		for (let argObject of argObjects) {
			let value: env.ArgObject | undefined;
			// If it's a mutation, verify the kind.
			if (argObject instanceof tg.Mutation) {
				if (argObject.inner.kind === "unset") {
					// If it's an unset mutation, replace the running result.
					result = {};
				} else if (argObject.inner.kind === "set") {
					// If it's a set mutation, use the value for the remaining merge logic.
					value = argObject.inner.value as env.ArgObject;
				} else {
					throw new Error(
						`Unsupported mutation kind for env.argObject: ${argObject.inner.kind}`,
					);
				}
			} else {
				// Use the value directly.
				value = argObject;
			}
			for await (let [key, val] of Object.entries(value ?? {})) {
				if (val === undefined) {
					// do nothing
					continue;
				}
				// Grab the existing value for this key, if any.
				let current = result[key];

				// Mutate the current value according to the new value.
				if (val instanceof tg.Mutation) {
					let mutationKind = val.inner.kind;
					switch (mutationKind) {
						case "unset": {
							// If it's an unset mutation, replace the current value.
							current = undefined;
							break;
						}
						case "set":
						case "set_if_unset":
						case "prefix":
						case "suffix": {
							current = await env.mergeTemplateMaybeMutations(current, val);
							break;
						}
						default: {
							throw new Error(
								`Unsupported mutation kind for env.argObject: ${mutationKind}`,
							);
						}
					}
				} else {
					let newValues = Array.isArray(val) ? val : [val];
					for (let newVal of std.flatten(newValues)) {
						// If it's not a mutation, wrap it in a set mutation.
						if (!(newVal instanceof tg.Mutation)) {
							newVal = await tg.Mutation.set<tg.Template.Arg>(
								templateFromArg(newVal),
							);
						} else {
							tg.assert(newVal instanceof tg.Mutation);
							if (newVal.inner.kind === "set") {
								tg.assert(std.args.isTemplateArg(newVal.inner.value));
								newVal = await tg.Mutation.set(
									templateFromArg(newVal.inner.value),
								);
							} else if (newVal.inner.kind === "set_if_unset") {
								tg.assert(std.args.isTemplateArg(newVal.inner.value));
								newVal = await tg.Mutation.setIfUnset(
									templateFromArg(newVal.inner.value),
								);
							} else if (newVal.inner.kind === "prefix") {
								tg.assert(std.args.isTemplateArg(newVal.inner.template));
								newVal = await tg.Mutation.prefix(
									templateFromArg(newVal.inner.template),
									newVal.inner.separator,
								);
							} else if (newVal.inner.kind === "suffix") {
								tg.assert(std.args.isTemplateArg(newVal.inner.template));
								newVal = await tg.Mutation.suffix(
									templateFromArg(newVal.inner.template),
									newVal.inner.separator,
								);
							}
						}
						// At this point, we know we have a mutation.
						tg.assert(newVal instanceof tg.Mutation);
						// Merge it with the current value.
						current = await env.mergeTemplateMaybeMutations(current, newVal);
					}
				}

				// Set the new value.
				result[key] = current;
			}
		}
		return result;
	};

	/** Convert booleans to the proper string, "1" for true, empty string for false. */
	let templateFromArg = (val: tg.Template.Arg | boolean) => {
		if (typeof val === "boolean") {
			return tg.template(val ? "1" : "");
		}
		return tg.template(val);
	};

	/** Combine two tg.MaybeMutation<tg.Template.Arg> values into one. */
	export let mergeTemplateMaybeMutations = async (
		a: tg.MaybeMutation<tg.Template.Arg>,
		b: tg.MaybeMutation<tg.Template.Arg>,
	): Promise<tg.MaybeMutation<tg.Template.Arg>> => {
		// Reject prepend and append mutations.
		if (
			(a instanceof tg.Mutation && a.inner.kind === "prepend") ||
			(a instanceof tg.Mutation && a.inner.kind === "append")
		) {
			throw new Error(`Unsupported mutation kind for env.argObject: ${a}`);
		}
		if (
			(b instanceof tg.Mutation && b.inner.kind === "prepend") ||
			(b instanceof tg.Mutation && b.inner.kind === "append")
		) {
			throw new Error(`Unsupported mutation kind for env.argObject: ${b}`);
		}

		// If either arg is undefined, return the other.
		if (a === undefined) {
			return b;
		}
		if (b === undefined) {
			return a;
		}

		// Wrap the values in mutations if they are not already.
		if (!(a instanceof tg.Mutation)) {
			a = await tg.Mutation.set<tg.Template.Arg>(a);
		}
		if (!(b instanceof tg.Mutation)) {
			b = await tg.Mutation.set<tg.Template.Arg>(b);
		}

		// Merge the mutations.
		let merged = await std.args.mergeMutations(a, b, true);

		// If there is more than one mutation, throw an error.
		if (merged.length !== 1) {
			throw new Error(`Failed to merge mutations`);
		}
		let ret = merged.at(0);
		tg.assert(ret instanceof tg.Mutation);
		return ret as tg.Mutation<tg.Template.Arg>;
	};

	/////// Queries

	type BinsInPathArg = {
		env: env.Arg;
		predicate?: (name: string) => boolean;
	};

	/** Return each binary in PATH with a name optionally matching a predicate, iterating alphabetically through each directory in descending order of precedence.. */
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
					(artifact instanceof tg.File || artifact instanceof tg.Symlink)
				) {
					if (artifact instanceof tg.Symlink) {
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

		for (let chunk of Array.from(separateTemplate(value, separator))) {
			let [directory, subpath] = chunk;
			// If this chunk represents a real tg.Directory, iterate through it looking for matches.
			if (
				directory &&
				typeof directory !== "string" &&
				directory instanceof tg.Directory &&
				subpath &&
				typeof subpath === "string"
			) {
				// Slice off the leading `/`.
				let subdir = await directory.get(subpath.slice(1));
				if (subdir instanceof tg.Directory) {
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
					directory instanceof tg.Directory &&
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
					directory instanceof tg.Directory &&
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
		for await (let [foundKey, value] of envVars(env)) {
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
		for await (let [foundKey, value] of envVars(env)) {
			if (foundKey === key) {
				return value;
			}
		}
		return undefined;
	}

	/** Yield all the environment key/value pairs. */
	export async function* envVars(
		...envArg: std.Args<env.Arg>
	): AsyncGenerator<[string, tg.Template | undefined]> {
		let map = await env.arg(envArg);
		let value: env.EnvObject | undefined;
		if (map instanceof tg.Mutation) {
			if (map.inner.kind === "unset") {
				return;
			} else if (map.inner.kind === "set") {
				value = map.inner.value as env.EnvObject;
			}
		} else {
			value = map;
		}
		for await (let [key, val] of Object.entries(value ?? {})) {
			if (val instanceof tg.Mutation) {
				let innerValue;
				if (val.inner.kind === "set" || val.inner.kind === "set_if_unset") {
					innerValue = val.inner.value;
				} else if (val.inner.kind === "prefix" || val.inner.kind === "suffix") {
					innerValue = val.inner.template;
				} else {
					continue;
				}
				tg.assert(
					std.args.isTemplateArg(innerValue),
					`expected template arg, got ${innerValue}`,
				);
				yield [key, await tg.template(innerValue)];
			} else {
				yield [key, await tg.template(val)];
			}
		}
	}

	/** Return the value of `SHELL` if present. If not present, return the file providing `sh` in `PATH`. If not present, throw an error. */
	export let getShellExecutable = async (
		...envArgs: std.Args<env.Arg>
	): Promise<tg.File | tg.Symlink> => {
		// First, check if "SHELL" is set and points to an executable.
		let envArg = await arg(envArgs);
		let shellArtifact = await env.tryGetArtifactByKey({
			env: envArg,
			key: "SHELL",
		});
		if (shellArtifact) {
			tg.assert(
				shellArtifact instanceof tg.File || shellArtifact instanceof tg.Symlink,
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
		...envArgs: std.Args<env.Arg>
	): Promise<tg.File | tg.Symlink | undefined> => {
		let envArg = await arg(envArgs);
		// First, check if "SHELL" is set and points to an executable.
		let shellArtifact = await tryGetArtifactByKey({
			env: envArg,
			key: "SHELL",
		});
		if (shellArtifact) {
			tg.assert(
				shellArtifact instanceof tg.File || shellArtifact instanceof tg.Symlink,
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
				if (executable instanceof tg.Symlink || executable instanceof tg.File) {
					return executable;
				}
			}
		}
		return undefined;
	};
}

let isUtilsToggle = (arg: unknown): arg is env.UtilsToggle => {
	return typeof arg === "object" && arg !== null && "utils" in arg;
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
