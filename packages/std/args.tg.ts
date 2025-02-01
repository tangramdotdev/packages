import * as std from "./tangram.ts";

/** Standard values that packages pass to their dependencies */
export type PackageArg = { [key: string]: tg.Value } & {
	build?: string | undefined;
	dependencies?: DependencyArgs;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | undefined;
};

/** A function that accepts a variable amount of package args and produces a directory. This is the standard type for the default exports of most packages. */
export type BuildCommand<T extends PackageArg> =
	| ((...args: UnresolvedArgs<T>) => Promise<tg.Directory>)
	| tg.Command<Args<T>, tg.Directory>;

/** Evaluate the command with a single arg. */
export const buildCommandOutput = async <T extends PackageArg>(
	cmd: BuildCommand<T>,
	arg: T,
): Promise<tg.Directory> => {
	return (cmd as (...args: Array<T>) => Promise<tg.Directory>)(arg);
};

/** After application, the resulting type always has concrete values for build, host, and sdk. */
export type ResolvedPackageArg<T extends PackageArg> = Omit<
	T,
	"build" | "env" | "host" | "sdk" | "dependencies"
> & {
	build: string;
	dependencies?: ResolvedDependencyArgs;
	env?: std.env.Arg;
	host: string;
	sdk: std.sdk.Arg;
};

export type ResolvedDependencyArgs = {
	[key: string]: ResolvedPackageArg<PackageArg>;
};

export type DependencyArgs = { [key: string]: boolean | PackageArg };

export type DependencyArg<T> = Omit<T, "build" | "host">;

/** Variadic argument type. */
export type Args<T extends tg.Value = tg.Value> = Array<
	tg.MaybeNestedArray<ValueOrMaybeMutationMap<T>>
>;

/** Variadic argument type. */
export type UnresolvedArgs<T extends tg.Value = tg.Value> = Array<
	tg.Unresolved<tg.MaybeNestedArray<ValueOrMaybeMutationMap<T>>>
>;

/** Produce a single argument object from a variadic list of arguments with mutation handling. */
export const apply = async <T extends PackageArg>(
	...args: Args<T>
): Promise<ResolvedPackageArg<T>> => {
	const flattened = std.flatten(args);
	type Collect = MakeArrayKeys<T, "dependencies" | "env" | "sdk">;
	const mutations = await createMutations<
		T,
		MakeArrayKeys<T, "dependencies" | "env" | "sdk">
	>(flattened, {
		dependencies: "append",
		env: "append",
		sdk: "append",
	} as Rules<T>);
	const arg = await applyMutations<Collect>(mutations);

	// Determine build and host;
	const build = arg.build ?? (await std.triple.host());
	const host = arg.host ?? (await std.triple.host());

	// Create env and SDK.
	const env = await std.env.arg(arg.env);
	const sdk = await std.sdk.arg(std.triple.rotate({ build, host }), arg.sdk);

	// Process dependency args.
	const dependencyArgs = arg.dependencies ?? [];
	const resolvedDependencies: ResolvedDependencyArgs = {};
	for (const dependency of dependencyArgs) {
		if (dependency === undefined) {
			continue;
		}
		for (let [key, value] of Object.entries(dependency)) {
			// Skip if false, omitting the key.
			if (value === false) {
				delete resolvedDependencies[key];
				continue;
			}

			// Convert true to empty object
			if (value === true) {
				if (!(key in resolvedDependencies)) {
					value = {
						build,
						dependencies: {},
						env: {},
						host,
						sdk: {},
					};
				}
			}

			// Ensure we no longer have a boolean.
			tg.assert(typeof value !== "boolean");

			const existing = resolvedDependencies[key];

			resolvedDependencies[key] = {
				...existing,
				build: value.build ?? existing?.build ?? build,
				dependencies:
					(value.dependencies
						? (
								await apply({
									dependencies: {
										...existing?.dependencies,
										...value.dependencies,
									},
								})
							).dependencies
						: existing?.dependencies) ?? {},
				env: await std.env.arg(existing?.env, value.env),
				host: value.host ?? existing?.host ?? host,
				sdk: await std.sdk.arg(existing?.sdk, value.sdk),
			};
		}
	}

	return {
		...arg,
		build,
		dependencies: resolvedDependencies,
		env,
		host,
		sdk,
	} as ResolvedPackageArg<T>;
};

export const createMutations = async <
	T extends { [key: string]: tg.Value } = { [key: string]: tg.Value },
	U extends { [key: string]: tg.Value } = T,
>(
	args: Array<MaybeMutationMap<T>>,
	rules?: Rules<T>,
): Promise<Array<MutationMap<U>>> => {
	// Process the objects to the intermediate type.
	return await Promise.all(
		args.map(async (arg) => {
			const object: { [key: string]: tg.Mutation } = {};
			// Go through the keys. If the key is in the mutate rules, apply the mutation.
			// If it's not, apply a default mutation.
			for (const [key, value] of Object.entries(arg)) {
				if (value === undefined) {
					continue;
				}

				// If the value is a mutation, set it directly.
				if (value instanceof tg.Mutation) {
					object[key] = value;
					continue;
				}

				// Otherwise, apply the specified mutation.
				const mutation = rules !== undefined ? rules[key] : undefined;
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

export const applyMutations = async <
	T extends { [key: string]: tg.Value } = { [key: string]: tg.Value },
>(
	args: Array<MaybeMutationMap<T>>,
): Promise<T> => {
	return await args.reduce(
		async (object, mutations) => {
			if (mutations === undefined) {
				return Promise.resolve({}) as Promise<T>;
			}
			for (const [key, mutation] of Object.entries(mutations)) {
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
	| tg.Command
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
export const isTemplateArg = (arg: unknown): arg is tg.Template.Arg => {
	return (
		typeof arg === "string" || tg.Artifact.is(arg) || arg instanceof tg.Template
	);
};

/** Merge mutations if possible. By default, it will not merge template or array mutations where one is a prepend and the other is an append. Set `aggressive` to `true` to merge these cases as well. */
export const mergeMutations = async (
	a: tg.Mutation,
	b: tg.Mutation,
	aggressive = false,
): Promise<Array<tg.Mutation>> => {
	if (a.inner.kind === "unset" && b.inner.kind === "unset") {
		return [b];
	} else if (a.inner.kind === "unset" && b.inner.kind === "set") {
		return [b];
	} else if (a.inner.kind === "unset" && b.inner.kind === "set_if_unset") {
		const val = b.inner.value;
		return [await tg.Mutation.set<tg.Value>(val)];
	} else if (a.inner.kind === "unset" && b.inner.kind === "prefix") {
		return [b];
	} else if (a.inner.kind === "unset" && b.inner.kind === "suffix") {
		return [b];
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
		const setVal = a.inner.value;
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
		const setVal = a.inner.value;
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
					a.inner.separator,
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
					a.inner.separator,
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

const mutate = async (
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
		const array = object[key];
		tg.assert(array instanceof Array);
		object[key] = [...std.flatten(mutation.inner.values), ...array];
	} else if (mutation.inner.kind === "append") {
		if (!(key in object) || object[key] === undefined) {
			object[key] = [];
		}
		const array = object[key];
		tg.assert(array instanceof Array);
		object[key] = [...array, ...std.flatten(mutation.inner.values)];
	} else if (mutation.inner.kind === "prefix") {
		if (!(key in object)) {
			object[key] = await tg.template();
		}
		const value = object[key];
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
		const value = object[key];
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
