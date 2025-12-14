import * as std from "./tangram.ts";

export type Args<T extends tg.Value = tg.Value> = Array<
	tg.Unresolved<tg.ValueOrMaybeMutationMap<T>>
>;

/** Base argument type for packages to extend. Add build-system-specific options (autotools, cmake, cargo, etc.) and package-specific dependencies by intersection. */
export type BasePackageArg = {
	build?: string | undefined;
	dependencies?: DependencyArgs | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	/** Top-level phases that merge with builder-specific phases. */
	phases?: std.phases.Arg;
	sdk?: std.sdk.Arg | undefined;
	source?: tg.Directory | undefined;
};

/** Internal constraint type for package arguments. Includes index signature for type system compatibility. */
export type PackageArg = { [key: string]: tg.Value } & BasePackageArg;

export type DependencyArg<T extends BasePackageArg> =
	| Omit<T, "build" | "host">
	| true;

export type OptionalDependencyArg<T extends BasePackageArg> =
	| Omit<T, "build" | "host">
	| boolean;

export type DependencyArgs = {
	[key: string]: OptionalDependencyArg<PackageArg>;
};

type Input<T extends tg.Value, O extends { [key: string]: tg.Value }> = {
	args: tg.Args<T>;
	map: (
		arg: tg.ValueOrMaybeMutationMap<T>,
	) => tg.MaybePromise<tg.MaybeMutationMap<O>>;
	reduce: {
		[K in keyof O]:
			| tg.Mutation.Kind
			| ((a: O[K] | undefined, b: O[K]) => tg.MaybePromise<O[K]>);
	};
};

export type MakeArrayKeys<T, K extends keyof T> = {
	[P in keyof T]: P extends K ? Array<T[P]> : T[P];
};

export const apply = async <
	T extends tg.Value,
	O extends { [key: string]: tg.Value },
>(
	input: Input<T, O>,
): Promise<O> => {
	let { args, map, reduce } = input;
	let resolved = (await Promise.all(args.map(tg.resolve))) as Array<
		tg.ValueOrMaybeMutationMap<T>
	>;
	let output: { [key: string]: tg.Value } = {};
	for (let arg of resolved) {
		let object = await map(arg);
		for (let [key, value] of Object.entries(object)) {
			if (value instanceof tg.Mutation) {
				await value.apply(output, key);
			} else if (reduce[key] !== undefined) {
				if (typeof reduce[key] === "string") {
					let mutation: tg.Mutation;
					switch (reduce[key]) {
						case "set":
							mutation = await tg.Mutation.set(value);
							break;
						case "unset":
							mutation = tg.Mutation.unset();
							break;
						case "set_if_unset":
							mutation = await tg.Mutation.setIfUnset(value);
							break;
						case "prepend":
							mutation = await tg.Mutation.prepend(value);
							break;
						case "append":
							mutation = await tg.Mutation.append(value);
							break;
						case "prefix":
							tg.assert(
								value instanceof tg.Template ||
									tg.Artifact.is(value) ||
									typeof value === "string",
							);
							mutation = await tg.Mutation.prefix(value);
							break;
						case "suffix":
							tg.assert(
								value instanceof tg.Template ||
									tg.Artifact.is(value) ||
									typeof value === "string",
							);
							mutation = await tg.Mutation.suffix(value);
							break;
						case "merge":
							mutation = await tg.Mutation.merge(value);
							break;
						default:
							return tg.unreachable(`unknown mutation kind "${reduce[key]}"`);
					}
					await mutation.apply(output, key);
				} else {
					output[key] = await reduce[key](
						output[key] as O[typeof key] | undefined,
						value,
					);
				}
			} else {
				output[key] = value;
			}
		}
	}
	return output as O;
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
	}
	if (a.inner.kind === "unset" && b.inner.kind === "set") {
		return [b];
	}
	if (a.inner.kind === "unset" && b.inner.kind === "set_if_unset") {
		const val = b.inner.value;
		return [await tg.Mutation.set<tg.Value>(val)];
	}
	if (a.inner.kind === "unset" && b.inner.kind === "prefix") {
		return [b];
	}
	if (a.inner.kind === "unset" && b.inner.kind === "suffix") {
		return [b];
	}
	if (a.inner.kind === "unset" && b.inner.kind === "append") {
		return [b];
	}
	if (a.inner.kind === "unset" && b.inner.kind === "prepend") {
		return [b];
	}
	if (a.inner.kind === "set" && b.inner.kind === "unset") {
		return [b];
	}
	if (a.inner.kind === "set" && b.inner.kind === "set") {
		return [b];
	}
	if (a.inner.kind === "set" && b.inner.kind === "set_if_unset") {
		return [a];
	}
	if (a.inner.kind === "set" && b.inner.kind === "prefix") {
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
		}
		return [a, b];
	}
	if (a.inner.kind === "set" && b.inner.kind === "suffix") {
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
		}
		return [a, b];
	}
	if (a.inner.kind === "set" && b.inner.kind === "append") {
		return [a, b];
	}
	if (a.inner.kind === "set" && b.inner.kind === "prepend") {
		return [a, b];
	}
	if (a.inner.kind === "set_if_unset" && b.inner.kind === "unset") {
		return [b];
	}
	if (a.inner.kind === "set_if_unset" && b.inner.kind === "set") {
		return [b];
	}
	if (a.inner.kind === "set_if_unset" && b.inner.kind === "set_if_unset") {
		return [a];
	}
	if (a.inner.kind === "set_if_unset" && b.inner.kind === "prefix") {
		return [a, b];
	}
	if (a.inner.kind === "set_if_unset" && b.inner.kind === "suffix") {
		return [a, b];
	}
	if (a.inner.kind === "set_if_unset" && b.inner.kind === "append") {
		return [a, b];
	}
	if (a.inner.kind === "set_if_unset" && b.inner.kind === "prepend") {
		return [a, b];
	}
	if (a.inner.kind === "prefix" && b.inner.kind === "unset") {
		return [b];
	}
	if (a.inner.kind === "prefix" && b.inner.kind === "set") {
		return [b];
	}
	if (a.inner.kind === "prefix" && b.inner.kind === "set_if_unset") {
		return [a];
	}
	if (a.inner.kind === "prefix" && b.inner.kind === "prefix") {
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
		}
		return [a, b];
	}
	if (a.inner.kind === "prefix" && b.inner.kind === "suffix") {
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
		}
		return [a, b];
	}
	if (a.inner.kind === "prefix" && b.inner.kind === "append") {
		return [a, b];
	}
	if (a.inner.kind === "prefix" && b.inner.kind === "prepend") {
		return [a, b];
	}
	if (a.inner.kind === "suffix" && b.inner.kind === "unset") {
		return [b];
	}
	if (a.inner.kind === "suffix" && b.inner.kind === "set") {
		return [b];
	}
	if (a.inner.kind === "suffix" && b.inner.kind === "set_if_unset") {
		return [a];
	}
	if (a.inner.kind === "suffix" && b.inner.kind === "prefix") {
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
		}
		return [a, b];
	}
	if (a.inner.kind === "suffix" && b.inner.kind === "suffix") {
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
		}
		return [a, b];
	}
	if (a.inner.kind === "suffix" && b.inner.kind === "append") {
		return [a, b];
	}
	if (a.inner.kind === "suffix" && b.inner.kind === "prepend") {
		return [a, b];
	}
	if (a.inner.kind === "append" && b.inner.kind === "unset") {
		return [b];
	}
	if (a.inner.kind === "append" && b.inner.kind === "set") {
		return [b];
	}
	if (a.inner.kind === "append" && b.inner.kind === "set_if_unset") {
		return [a];
	}
	if (a.inner.kind === "append" && b.inner.kind === "append") {
		return [await tg.Mutation.append(a.inner.values.concat(b.inner.values))];
	}
	if (a.inner.kind === "append" && b.inner.kind === "prepend") {
		if (aggressive) {
			return [await tg.Mutation.append(b.inner.values.concat(a.inner.values))];
		}
		return [a, b];
	}
	if (a.inner.kind === "append" && b.inner.kind === "suffix") {
		return [a, b];
	}
	if (a.inner.kind === "append" && b.inner.kind === "prefix") {
		return [a, b];
	}
	if (a.inner.kind === "prepend" && b.inner.kind === "unset") {
		return [b];
	}
	if (a.inner.kind === "prepend" && b.inner.kind === "set") {
		return [b];
	}
	if (a.inner.kind === "prepend" && b.inner.kind === "set_if_unset") {
		return [a];
	}
	if (a.inner.kind === "prepend" && b.inner.kind === "append") {
		if (aggressive) {
			return [await tg.Mutation.prepend(a.inner.values.concat(b.inner.values))];
		}
		return [a, b];
	}
	if (a.inner.kind === "prepend" && b.inner.kind === "prepend") {
		return [await tg.Mutation.prepend(b.inner.values.concat(a.inner.values))];
	}
	if (a.inner.kind === "prepend" && b.inner.kind === "suffix") {
		return [a, b];
	}
	if (a.inner.kind === "prepend" && b.inner.kind === "prefix") {
		return [a, b];
	}
	if (a.inner.kind === "merge" || b.inner.kind === "merge") {
		return [a, b];
	}
	return tg.unreachable();
};
