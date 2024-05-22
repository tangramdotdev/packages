import * as std from "./tangram.tg.ts";

/** Standard values that packages pass to their dependencies */
export type PackageArg = { [key: string]: tg.Value } & {
	build?: string;
	dependencies?: { [key: string]: tg.Value };
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
};

/** Variadic argument type. */
export type Args<T extends tg.Value = tg.Value> = Array<
	tg.MaybeNestedArray<ValueOrMaybeMutationMap<T>>
>;

/** Variadic argument type. */
export type UnresolvedArgs<T extends tg.Value = tg.Value> = Array<
	tg.Unresolved<tg.MaybeNestedArray<ValueOrMaybeMutationMap<T>>>
>;

// /** Coalesce variadic arguments into a single argument, propogating the known keys to any dependencies. */
// export let apply = async <T extends PackageArg>(
// 	...args: std.Args<T>
// ): Promise<T> => {
// 	// Coalesce top-level ones, and ensure dependencies receive relevent arguments.

// 	type Apply = { [key: string]: tg.Value } & {
// 		build?: string;
// 		env?: Array<std.env.Arg>;
// 		host?: string;
// 		sdk?: Array<std.sdk.Arg>;
// 		dependencies?: { [key: string]: Array<PackageArg> };
// 	};
// 	let intermediate = await std.Args.apply<T, Apply>(args, async (arg) => {
// 		let object: tg.MutationMap<Apply> = {};

// 		// Handle known keys.
// 		if (arg.build !== undefined) {
// 			object.build = arg.build;
// 		}
// 		if (arg.env !== undefined) {
// 			if (arg.env instanceof tg.Mutation) {
// 				object.env = arg.env;
// 			} else {
// 				object.env = await tg.Mutation.append<std.env.Arg>(arg.env);
// 			}
// 		}
// 		if (arg.host !== undefined) {
// 			object.host = arg.host;
// 		}
// 		if (arg.sdk !== undefined) {
// 			if (arg.sdk instanceof tg.Mutation) {
// 				object.sdk = arg.sdk;
// 			} else {
// 				object.sdk = await tg.Mutation.append<std.sdk.Arg>(arg.sdk);
// 			}
// 		}

// 		// Handle unknown non-dependency keys.
// 		let knownKeys = ["build", "env", "host", "sdk", "dependencies"];
// 		let remainingKeys = Object.keys(arg).filter(
// 			(key) => !knownKeys.includes(key),
// 		);
// 		for (let key of remainingKeys) {
// 			if (arg[key] !== undefined) {
// 				object[key] = arg[key];
// 			}
// 		}

// 		// Handle dependencies.
// 		if (arg.dependencies !== undefined) {
// 			let argDependencies = arg.dependencies as tg.MutationMap<{
// 				[key: string]: PackageArg;
// 			}>;
// 			let keys = Object.keys(argDependencies);
// 			let dependencies: tg.MutationMap<{ [key: string]: Array<PackageArg> }> =
// 				{};
// 			object.dependencies = dependencies;
// 			for (let key of keys) {
// 				let dependencyArg = argDependencies[key];
// 				if (dependencyArg instanceof tg.Mutation) {
// 					object.dependencies[key] = dependencyArg;
// 				} else {
// 					dependencies[key] = await tg.Mutation.append(dependencyArg);
// 				}
// 			}
// 		}

// 		return object;
// 	});

// 	// Combine env.
// 	let env = await std.env.arg(intermediate.env);
// 	// Combine sdk args.
// 	let sdk = await std.sdk.arg(intermediate.sdk);
// 	// Add build and host.
// 	let build = intermediate.build;
// 	let host = intermediate.host;
// 	let propagatedArgs = {
// 		build,
// 		env,
// 		host,
// 		sdk,
// 	};
// 	// Prepend the above to each dependency.
// 	let dependenciesArrarys: { [key: string]: Array<PackageArg> } = {};
// 	let dependencies: { [key: string]: PackageArg } = {};
// 	let intermediateDependencies = intermediate.dependencies ?? {};
// 	let keys = Object.keys(intermediateDependencies);
// 	for (let key of keys) {
// 		let dependencyArgs = intermediateDependencies[key] ?? [];
// 		dependencies[key] = std.flatten([propagatedArgs, dependencyArgs]);
// 	}

// 	return { ...intermediate, build, env, host, sdk, dependencies } as T;
// };

export let createMutations = async <
	T extends { [key: string]: tg.Value } = { [key: string]: tg.Value },
	U extends { [key: string]: tg.Value } = T,
>(
	args: Array<MaybeMutationMap<T>>,
	rules?: Rules<T>,
): Promise<Array<MutationMap<U>>> => {
	// Process the objects to the intermediate type.
	return await Promise.all(
		args.map(async (arg) => {
			let object: { [key: string]: tg.Mutation } = {};
			// Go through the keys. If the key is in the mutate rules, apply the mutation.
			// If it's not, apply a default mutation.
			for (let [key, value] of Object.entries(arg)) {
				if (value === undefined) {
					continue;
				}

				// If the value is a mutation, set it directly.
				if (value instanceof tg.Mutation) {
					object[key] = value;
					continue;
				}

				// Otherwise, apply the specified mutation.
				let mutation = rules !== undefined ? rules[key] : undefined;
				if (mutation === undefined) {
					object[key] = await tg.Mutation.set<typeof value>(value);
				} else if (typeof mutation === "string") {
					switch (mutation) {
						case "set":
							object[key] = await tg.Mutation.set(value);
							break;
						case "unset":
							object[key] = tg.Mutation.unset();
							break;
						case "set_if_unset":
							object[key] = await tg.Mutation.setIfUnset(value);
							break;
						case "prepend":
							object[key] = await tg.Mutation.prepend(value);
							break;
						case "append":
							object[key] = await tg.Mutation.append(value);
							break;
						case "prefix":
							tg.assert(
								value instanceof tg.Template ||
									tg.Artifact.is(value) ||
									typeof value === "string",
							);
							object[key] = await tg.Mutation.prefix(value);
							break;
						case "suffix":
							tg.assert(
								value instanceof tg.Template ||
									tg.Artifact.is(value) ||
									typeof value === "string",
							);
							object[key] = await tg.Mutation.suffix(value);
							break;
						default:
							return tg.unreachable(`Unknown mutation kind: ${mutation}`);
					}
				} else {
					object[key] = await mutation(value);
				}
			}
			return object as MutationMap<U>;
		}),
	);
};

export let applyMutations = async <
	T extends { [key: string]: tg.Value } = { [key: string]: tg.Value },
>(
	args: Array<MaybeMutationMap<T>>,
): Promise<T> => {
	return await args.reduce(
		async (object, mutations) => {
			for (let [key, mutation] of Object.entries(mutations)) {
				await mutate(await object, key, mutation);
			}
			return object;
		},
		Promise.resolve({}) as Promise<T>,
	);
};

export type ValueOrMaybeMutationMap<T extends tg.Value = tg.Value> = T extends
	| undefined
	| boolean
	| number
	| string
	| Uint8Array
	| tg.Blob
	| tg.Directory
	| tg.File
	| tg.Symlink
	| tg.Lock
	| tg.Target
	| tg.Mutation
	| tg.Template
	| Array<infer _U extends tg.Value>
	? T
	: T extends { [key: string]: tg.Value }
	  ? MaybeMutationMap<T>
	  : never;

export type MaybeMutationMap<
	T extends { [key: string]: tg.Value } = { [key: string]: tg.Value },
> = {
	[K in keyof T]?: tg.MaybeMutation<T[K]>;
};

export type MutationMap<
	T extends { [key: string]: tg.Value } = { [key: string]: tg.Value },
> = {
	[K in keyof T]?: tg.Mutation<T[K]>;
};

export type Rules<
	T extends { [key: string]: tg.Value } = { [key: string]: tg.Value },
> = {
	[K in keyof T]: MutationKind | ((arg: T[K]) => Promise<tg.Mutation<T[K]>>);
};

export type MutationKind =
	| "set"
	| "unset"
	| "set_if_unset"
	| "prepend"
	| "append"
	| "prefix"
	| "suffix";

export type MakeRequired<T> = {
	[K in keyof T]-?: T[K];
};

export type MakeArrayKeys<T, K extends keyof T> = {
	[P in keyof T]: P extends K ? Array<T[P]> : T[P];
};

/** Determine whether a value is a `tg.Template.Arg`. */
export let isTemplateArg = (arg: unknown): arg is tg.Template.Arg => {
	return (
		typeof arg === "string" || tg.Artifact.is(arg) || arg instanceof tg.Template
	);
};

/** Merge mutations if possible. By default, it will not merge template or array mutations where one is a prepend and the other is an append. Set `aggressive` to `true` to merge these cases as well. */
export let mergeMutations = async (
	a: tg.Mutation,
	b: tg.Mutation,
	aggressive = false,
): Promise<Array<tg.Mutation>> => {
	if (a.inner.kind === "unset" && b.inner.kind === "unset") {
		return [b];
	} else if (a.inner.kind === "unset" && b.inner.kind === "set") {
		return [b];
	} else if (a.inner.kind === "unset" && b.inner.kind === "set_if_unset") {
		let val = b.inner.value;
		return [await tg.Mutation.set<tg.Value>(val)];
	} else if (a.inner.kind === "unset" && b.inner.kind === "prefix") {
		return [await tg.Mutation.set(b.inner.template)];
	} else if (a.inner.kind === "unset" && b.inner.kind === "suffix") {
		return [await tg.Mutation.set(b.inner.template)];
	} else if (a.inner.kind === "unset" && b.inner.kind === "append") {
		return [b];
	} else if (a.inner.kind === "unset" && b.inner.kind === "prepend") {
		return [b];
	} else if (a.inner.kind === "set" && b.inner.kind === "unset") {
		return [b];
	} else if (a.inner.kind === "set" && b.inner.kind === "set") {
		return [b];
	} else if (a.inner.kind === "set" && b.inner.kind === "set_if_unset") {
		return [a];
	} else if (a.inner.kind === "set" && b.inner.kind === "prefix") {
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
	} else if (a.inner.kind === "set" && b.inner.kind === "suffix") {
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
	} else if (a.inner.kind === "set" && b.inner.kind === "append") {
		return [a, b];
	} else if (a.inner.kind === "set" && b.inner.kind === "prepend") {
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
	} else if (a.inner.kind === "set_if_unset" && b.inner.kind === "prefix") {
		return [a, b];
	} else if (a.inner.kind === "set_if_unset" && b.inner.kind === "suffix") {
		return [a, b];
	} else if (a.inner.kind === "set_if_unset" && b.inner.kind === "append") {
		return [a, b];
	} else if (a.inner.kind === "set_if_unset" && b.inner.kind === "prepend") {
		return [a, b];
	} else if (a.inner.kind === "prefix" && b.inner.kind === "unset") {
		return [b];
	} else if (a.inner.kind === "prefix" && b.inner.kind === "set") {
		return [b];
	} else if (a.inner.kind === "prefix" && b.inner.kind === "set_if_unset") {
		return [a];
	} else if (a.inner.kind === "prefix" && b.inner.kind === "prefix") {
		if (a.inner.separator === b.inner.separator || aggressive) {
			return [
				await tg.Mutation.prefix(
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
	} else if (a.inner.kind === "prefix" && b.inner.kind === "suffix") {
		if (aggressive) {
			return [
				await tg.Mutation.prefix(
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
	} else if (a.inner.kind === "prefix" && b.inner.kind === "append") {
		return [a, b];
	} else if (a.inner.kind === "prefix" && b.inner.kind === "prepend") {
		return [a, b];
	} else if (a.inner.kind === "suffix" && b.inner.kind === "unset") {
		return [b];
	} else if (a.inner.kind === "suffix" && b.inner.kind === "set") {
		return [b];
	} else if (a.inner.kind === "suffix" && b.inner.kind === "set_if_unset") {
		return [a];
	} else if (a.inner.kind === "suffix" && b.inner.kind === "prefix") {
		if (aggressive) {
			return [
				await tg.Mutation.suffix(
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
	} else if (a.inner.kind === "suffix" && b.inner.kind === "suffix") {
		if (a.inner.separator === b.inner.separator || aggressive) {
			return [
				await tg.Mutation.suffix(
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
	} else if (a.inner.kind === "suffix" && b.inner.kind === "append") {
		return [a, b];
	} else if (a.inner.kind === "suffix" && b.inner.kind === "prepend") {
		return [a, b];
	} else if (a.inner.kind === "append" && b.inner.kind === "unset") {
		return [b];
	} else if (a.inner.kind === "append" && b.inner.kind === "set") {
		return [b];
	} else if (a.inner.kind === "append" && b.inner.kind === "set_if_unset") {
		return [a];
	} else if (a.inner.kind === "append" && b.inner.kind === "append") {
		return [
			await tg.Mutation.append<tg.Value>(a.inner.values.concat(b.inner.values)),
		];
	} else if (a.inner.kind === "append" && b.inner.kind === "prepend") {
		if (aggressive) {
			return [
				await tg.Mutation.append<tg.Value>(
					b.inner.values.concat(a.inner.values),
				),
			];
		} else {
			return [a, b];
		}
	} else if (a.inner.kind === "append" && b.inner.kind === "suffix") {
		return [a, b];
	} else if (a.inner.kind === "append" && b.inner.kind === "prefix") {
		return [a, b];
	} else if (a.inner.kind === "prepend" && b.inner.kind === "unset") {
		return [b];
	} else if (a.inner.kind === "prepend" && b.inner.kind === "set") {
		return [b];
	} else if (a.inner.kind === "prepend" && b.inner.kind === "set_if_unset") {
		return [a];
	} else if (a.inner.kind === "prepend" && b.inner.kind === "append") {
		if (aggressive) {
			return [
				await tg.Mutation.prepend<tg.Value>(
					a.inner.values.concat(b.inner.values),
				),
			];
		} else {
			return [a, b];
		}
	} else if (a.inner.kind === "prepend" && b.inner.kind === "prepend") {
		return [
			await tg.Mutation.prepend<tg.Value>(
				b.inner.values.concat(a.inner.values),
			),
		];
	} else if (a.inner.kind === "prepend" && b.inner.kind === "suffix") {
		return [a, b];
	} else if (a.inner.kind === "prepend" && b.inner.kind === "prefix") {
		return [a, b];
	} else {
		return tg.unreachable();
	}
};

let mutate = async (
	object: { [key: string]: tg.Value },
	key: string,
	mutation: tg.MaybeMutation,
) => {
	if (!(mutation instanceof tg.Mutation)) {
		object[key] = mutation;
	} else if (mutation.inner.kind === "unset") {
		delete object[key];
	} else if (mutation.inner.kind === "set") {
		object[key] = mutation.inner.value;
	} else if (mutation.inner.kind === "set_if_unset") {
		if (!(key in object)) {
			object[key] = mutation.inner.value;
		}
	} else if (mutation.inner.kind === "prepend") {
		if (!(key in object) || object[key] === undefined) {
			object[key] = [];
		}
		let array = object[key];
		tg.assert(array instanceof Array);
		object[key] = [...std.flatten(mutation.inner.values), ...array];
	} else if (mutation.inner.kind === "append") {
		if (!(key in object) || object[key] === undefined) {
			object[key] = [];
		}
		let array = object[key];
		tg.assert(array instanceof Array);
		object[key] = [...array, ...std.flatten(mutation.inner.values)];
	} else if (mutation.inner.kind === "prefix") {
		if (!(key in object)) {
			object[key] = await tg.template();
		}
		let value = object[key];
		tg.assert(
			value === undefined ||
				typeof value === "string" ||
				tg.Artifact.is(value) ||
				value instanceof tg.Template,
		);
		object[key] = await tg.Template.join(
			mutation.inner.separator,
			mutation.inner.template,
			value,
		);
	} else if (mutation.inner.kind === "suffix") {
		if (!(key in object)) {
			object[key] = await tg.template();
		}
		let value = object[key];
		tg.assert(
			value === undefined ||
				typeof value === "string" ||
				tg.Artifact.is(value) ||
				value instanceof tg.Template,
		);
		object[key] = await tg.Template.join(
			mutation.inner.separator,
			value,
			mutation.inner.template,
		);
	}
};
