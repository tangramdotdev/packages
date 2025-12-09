import * as std from "./tangram.ts";
import { type PackageArg, type DependencyArgs } from "./args.tg.ts";

/** A function that accepts a variable amount of package args and produces a directory. This is the standard type for the default exports of most packages. */
export type BuildCommand<T extends PackageArg> = (
	...args: std.Args<T>
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

/** Produce a single argument object from a variadic list of arguments with mutation handling. */
export const applyArgs = async <T extends PackageArg>(
	...args: std.Args<T>
): Promise<ResolvedPackageArg<T>> => {
	type Collect = std.args.MakeArrayKeys<T, "dependencies">;
	const arg = await std.args.apply<T, Collect>({
		args,
		map: async (arg) => {
			return {
				...arg,
				dependencies: [arg.dependencies],
			} as Collect;
		},
		reduce: {
			dependencies: "append",
			env: (a: std.env.Arg | undefined, b: std.env.Arg) =>
				std.env.arg(a, b, { utils: false }),
			sdk: (a: std.sdk.Arg | undefined, b: std.sdk.Arg) => std.sdk.arg(a, b),
		} as any,
	});

	// Determine build and host;
	const host = arg.host ?? std.triple.host();
	const build = arg.build ?? host;

	const env = arg.env;
	const sdk = arg.sdk;

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
										await applyArgs({
											dependencies: value.dependencies as DependencyArgs,
										})
									).dependencies
								: {}) ?? {},
						env: await std.env.arg(value.env as std.env.Arg, { utils: false }),
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
										await applyArgs({
											dependencies: {
												...existing?.dependencies,
												...(value.dependencies as DependencyArgs),
											},
										})
									).dependencies
								: existing?.dependencies) ?? {},
						env: await std.env.arg(existing?.env, value.env as std.env.Arg, {
							utils: false,
						}),
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
