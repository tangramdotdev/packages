import * as std from "./tangram.ts";

/** Standard values that packages pass to their dependencies */
export type PackageArg = { [key: string]: tg.Value } & {
	build?: string | undefined;
	dependencies?: DependencyArgs | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | undefined;
};

/** A function that accepts a variable amount of package args and produces a directory. This is the standard type for the default exports of most packages. */
export type BuildCommand<T extends PackageArg> = (
	...args: tg.Args<T>
) => Promise<tg.Directory>;

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
	[key: string]: ResolvedPackageArg<PackageArg> | boolean;
};

export type DependencyArgs = {
	[key: string]: OptionalDependencyArg<PackageArg>;
};

export type DependencyArg<T extends PackageArg> =
	| Omit<T, "build" | "host">
	| true;
export type OptionalDependencyArg<T extends PackageArg> =
	| Omit<T, "build" | "host">
	| boolean;

/** Variadic argument type. */
export type UnresolvedArgs<T extends tg.Value = tg.Value> = Array<
	tg.Unresolved<tg.MaybeNestedArray<tg.ValueOrMaybeMutationMap<T>>>
>;

/** Produce a single argument object from a variadic list of arguments with mutation handling. */
export const apply = async <T extends PackageArg>(
	...args: tg.Args<T>
): Promise<ResolvedPackageArg<T>> => {
	const resolved = await Promise.all(args.map(tg.resolve));
	type Collect = MakeArrayKeys<T, "dependencies" | "env" | "sdk">;
	const objects = resolved.map((obj) => {
		return {
			...obj,
			dependencies: [obj.dependencies],
			env: [obj.env],
			sdk: [obj.sdk],
		};
	});
	const arg = (await tg.Args.apply(objects, {
		dependencies: "append",
		env: "append",
		sdk: "append",
	})) as Collect;

	// Determine build and host;
	const build = arg.build ?? (await std.triple.host());
	const host = arg.host ?? (await std.triple.host());

	// Create env and SDK.
	const env = await std.env.arg(...(arg.env ?? []));
	const sdk = await std.sdk.arg(
		std.triple.rotate({ build, host }),
		...(arg.sdk ?? []),
	);

	// Process dependency args.
	const dependencyArgs = arg.dependencies ?? [];
	const resolvedDependencies: ResolvedDependencyArgs = {};
	for (const dependency of dependencyArgs) {
		if (dependency === undefined) {
			continue;
		}
		for (let [key, value] of Object.entries(dependency)) {
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

			const existing = resolvedDependencies[key];
			if (typeof existing === "boolean") {
				if (typeof value === "boolean") {
					resolvedDependencies[key] = value;
				} else {
					resolvedDependencies[key] = {
						build,
						dependencies:
							(value.dependencies
								? (
										await apply({
											dependencies: value.dependencies as DependencyArgs,
										})
									).dependencies
								: {}) ?? {},
						env: await std.env.arg(value.env as std.env.Arg),
						host,
						sdk: await std.sdk.arg(value.sdk as std.sdk.Arg),
					};
				}
			} else {
				if (typeof value === "boolean") {
					resolvedDependencies[key] = value;
				} else {
					resolvedDependencies[key] = {
						...existing,
						build: existing?.build ?? build,
						dependencies:
							(value.dependencies
								? (
										await apply({
											dependencies: {
												...existing?.dependencies,
												...(value.dependencies as DependencyArgs),
											},
										})
									).dependencies
								: existing?.dependencies) ?? {},
						env: await std.env.arg(existing?.env, value.env as std.env.Arg),
						host: existing?.host ?? host,
						sdk: await std.sdk.arg(existing?.sdk, value.sdk as std.sdk.Arg),
					};
				}
			}
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
		return [await tg.Mutation.append(a.inner.values.concat(b.inner.values))];
	} else if (a.inner.kind === "append" && b.inner.kind === "prepend") {
		if (aggressive) {
			return [await tg.Mutation.append(b.inner.values.concat(a.inner.values))];
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
			return [await tg.Mutation.prepend(a.inner.values.concat(b.inner.values))];
		} else {
			return [a, b];
		}
	} else if (a.inner.kind === "prepend" && b.inner.kind === "prepend") {
		return [await tg.Mutation.prepend(b.inner.values.concat(a.inner.values))];
	} else if (a.inner.kind === "prepend" && b.inner.kind === "suffix") {
		return [a, b];
	} else if (a.inner.kind === "prepend" && b.inner.kind === "prefix") {
		return [a, b];
	} else if (a.inner.kind === "merge" || b.inner.kind === "merge") {
		return [a, b];
	} else {
		return tg.unreachable();
	}
};
