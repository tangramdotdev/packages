import * as std from "./tangram.ts";
import {
	type BasePackageArg,
	type PackageArg,
	type DependencyArgs,
} from "./args.tg.ts";

/** Minimal constraint for package arg types. Only requires host for test execution. */
export type MinimalPackageArg = {
	host?: string | undefined;
};

/** A function that accepts a variable amount of package args and produces a directory. This is the standard type for the default exports of most packages. */
export type BuildFn<T extends MinimalPackageArg> = (
	...args: std.Args<T>
) => Promise<tg.Directory>;

/**
 * A tg.Command that builds a package, with phantom type parameter preserving the arg type.
 * Since tg.Command is tg.Object which is tg.Value, this can be included in Arg types.
 */
export type BuildCommand<T extends MinimalPackageArg = MinimalPackageArg> =
	tg.Command & { readonly __packageArg?: T };

/** Evaluate the build function or command with a single arg. Works with both functions and BuildCommands. */
export const buildCommandOutput = async <T extends MinimalPackageArg>(
	cmd: BuildFn<T> | BuildCommand<T>,
	arg: T,
): Promise<tg.Directory> => {
	if (typeof cmd === "function") {
		return (cmd as (...args: Array<T>) => Promise<tg.Directory>)(arg);
	}
	// For BuildCommand (tg.Command), use .build() method and expect a Directory.
	return tg.Directory.expect(await (cmd as tg.Command).build(arg));
};

/** After application, the resulting type always has concrete values for build, host, and sdk. */
export type ResolvedPackageArg<T extends BasePackageArg> = Omit<
	T,
	| "build"
	| "env"
	| "host"
	| "sdk"
	| "dependencies"
	| "subtreeEnv"
	| "subtreeSdk"
> & {
	build: string;
	dependencies?: ResolvedDependencyArgs;
	env?: std.env.Arg;
	host: string;
	sdk: std.sdk.Arg;
	subtreeEnv?: std.env.Arg;
	subtreeSdk?: std.sdk.Arg;
};

export type ResolvedDependencyArgs = {
	[key: string]: ResolvedPackageArg<BasePackageArg> | boolean;
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
			phases: (a: std.phases.PhasesArg, b: std.phases.PhasesArg) =>
				std.phases.arg(a, b),
			sdk: (a: std.sdk.Arg | undefined, b: std.sdk.Arg) => std.sdk.arg(a, b),
			subtreeEnv: (a: std.env.Arg | undefined, b: std.env.Arg) =>
				std.env.arg(a, b, { utils: false }),
			subtreeSdk: (a: std.sdk.Arg | undefined, b: std.sdk.Arg) =>
				std.sdk.arg(a, b),
		} as any,
	});

	// Determine build and host;
	const host = arg.host ?? std.triple.host();
	const build = arg.build ?? host;

	const env = arg.env;
	const sdk = arg.sdk;
	const subtreeEnv = arg.subtreeEnv;
	const subtreeSdk = arg.subtreeSdk;

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
						// Spread value first to preserve package-specific options.
						...value,
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
						// Spread existing then value to preserve package-specific options.
						...existing,
						...value,
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
		subtreeEnv,
		subtreeSdk,
	} as ResolvedPackageArg<T>;
};

/**
 * Create a deps Config from build functions.
 * Accepts either plain build functions or full specs with kind option.
 * Functions are stored directly and resolved lazily at build time via buildCommandOutput().
 * The type system treats them as BuildCommand for tg.Value compatibility.
 */
export function deps<T extends deps.Input>(input: T): deps.Output<T> {
	const result: Record<string, deps.Spec> = {};
	for (const [key, spec] of Object.entries(input)) {
		if (typeof spec === "function") {
			// Store function directly - buildCommandOutput handles both functions and commands.
			result[key] = spec as unknown as BuildCommand;
		} else {
			// Full spec with options.
			result[key] = {
				build: spec.build as unknown as BuildCommand,
				kind: spec.kind ?? "runtime",
			};
		}
	}
	return result as deps.Output<T>;
}

export namespace deps {
	/** The kind of dependency relationship. */
	export type Kind = "runtime" | "buildtime" | "full";

	/** Condition function that determines whether a dependency should be included. */
	export type Condition = (ctx: Context) => boolean;

	/**
	 * Full specification for a single dependency using BuildCommand.
	 * Note: Does not include `when` condition as functions are not tg.Value.
	 * Conditions should be handled at resolution time.
	 */
	export type FullSpec = {
		// biome-ignore lint/suspicious/noExplicitAny: Package commands are contravariant, requiring type erasure here.
		build: BuildCommand<any>;
		kind: Kind;
	};

	/** Specification for a single dependency - either a BuildCommand (defaults to runtime) or full spec. */
	// biome-ignore lint/suspicious/noExplicitAny: Package commands are contravariant, requiring type erasure here.
	export type Spec = BuildCommand<any> | FullSpec;

	/** Normalize a Spec to a FullSpec. */
	export const normalizeSpec = (spec: Spec): FullSpec => {
		// A FullSpec has a 'kind' property; a plain BuildCommand does not.
		if ("kind" in spec) {
			return spec as FullSpec;
		}
		return { build: spec as BuildCommand, kind: "runtime" };
	};

	/** A mapping of dependency names to their specifications. */
	export type Config = {
		[key: string]: Spec;
	};

	/** Type for deps property in builder Args. */
	export type ConfigArg = Config | tg.Command<[], Config>;

	/** Type constraint for deps.Arg type parameter. */
	export type ConfigLike = Config | (() => Config);

	/** Extract the underlying Config from a ConfigLike (unwraps function types). */
	export type ExtractConfig<T extends ConfigLike> = T extends () => infer R
		? R
		: T;

	/** Extract the package arg type from a Spec (either plain BuildCommand or FullSpec). */
	type ArgFromSpec<T extends Spec> = T extends FullSpec
		? T["build"] extends BuildCommand<infer A>
			? A
			: never
		: T extends BuildCommand<infer A>
			? A
			: never;

	/** Generate a dependencies type from a Config. */
	export type ArgsFrom<T extends Config> = {
		[K in keyof T]?: std.args.OptionalDependencyArg<ArgFromSpec<T[K]>>;
	};

	/** Generate an artifacts map type from a Config. */
	export type ArtifactsFrom<T extends Config> = {
		[K in keyof T]: tg.Directory | undefined;
	};

	/** Extract the dependencies Arg type from a deps Config. */
	export type Arg<T extends ConfigLike> = {
		dependencies?: ArgsFrom<ExtractConfig<T> & Config>;
	};

	/** Context required for deps resolution. */
	export type Context = {
		build: string;
		host: string;
		sdk?: std.sdk.Arg;
		/** Dependency argument overrides from user input. build/host are added automatically. */
		dependencies?: std.args.DependencyArgs | undefined;
		env?: tg.Unresolved<std.env.Arg>;
		/** Environment to propagate to all dependencies in the subtree. */
		subtreeEnv?: tg.Unresolved<std.env.Arg>;
		/** SDK configuration to propagate to all dependencies in the subtree. */
		subtreeSdk?: std.sdk.Arg;
	};

	/** Resolve a ConfigArg to a Config. */
	export const resolveConfig = async (
		configArg: tg.Unresolved<ConfigArg> | undefined,
	): Promise<Config | undefined> => {
		if (configArg === undefined) {
			return undefined;
		}
		const resolved = await tg.resolve(configArg);
		if (resolved instanceof tg.Command) {
			return (await resolved.build()) as Config;
		}
		return resolved as Config;
	};

	/** Resolve a deps config to a combined env. */
	export const env = async (
		configArg: tg.Unresolved<ConfigArg>,
		ctx: Context,
	): Promise<std.env.EnvObject> => {
		const config = await resolveConfig(configArg);
		if (!config) {
			return std.env.arg(ctx.env);
		}
		const artifactMap = await artifacts(config, ctx);
		const artifactList = Object.values(artifactMap).filter(
			(v): v is tg.Directory => v !== undefined,
		);
		return std.env.arg(...artifactList, ctx.env);
	};

	/** Resolve a deps config to individual artifacts by name. */
	export const artifacts = async <T extends Config>(
		configArg: tg.Unresolved<T | ConfigArg>,
		ctx: Context,
	): Promise<ArtifactsFrom<T>> => {
		const config = (await resolveConfig(
			configArg as tg.Unresolved<ConfigArg>,
		)) as T;
		if (!config) {
			return {} as ArtifactsFrom<T>;
		}
		const { build, host, dependencies = {}, subtreeEnv, subtreeSdk } = ctx;
		const artifactMap: Record<string, tg.Directory | undefined> = {};

		for (const [key, spec_] of Object.entries(config)) {
			const spec = normalizeSpec(spec_);
			const arg = dependencies[key];

			// Skip dependencies explicitly set to false.
			if (arg === false) {
				artifactMap[key] = undefined;
				continue;
			}

			// Determine build parameters based on kind.
			const setHostToBuild = spec.kind === "buildtime";
			const subdirs =
				spec.kind === "buildtime"
					? ["bin"]
					: spec.kind === "runtime"
						? ["include", "lib"]
						: undefined;

			// Prepare build argument.
			// Dependencies receive subtreeSdk as their sdk, and subtree* propagate down.
			// Plain sdk/env do NOT inherit to dependencies.
			const host_ = setHostToBuild ? build : host;
			let buildArg: Record<string, unknown>;
			if (arg === true || arg === undefined) {
				buildArg = {
					build,
					host: host_,
					sdk: subtreeSdk ?? {},
					subtreeSdk,
					subtreeEnv,
				};
			} else {
				// When user provides custom sdk for a dependency, merge with subtreeSdk.
				const argSdk = arg.sdk as std.sdk.Arg | undefined;
				const mergedSdk = argSdk
					? await std.sdk.arg(subtreeSdk, argSdk)
					: (subtreeSdk ?? {});
				buildArg = {
					...arg,
					build,
					host: host_,
					sdk: mergedSdk,
					// Allow dependency to override subtree values, otherwise propagate.
					subtreeSdk: (arg as Record<string, unknown>).subtreeSdk ?? subtreeSdk,
					subtreeEnv: (arg as Record<string, unknown>).subtreeEnv ?? subtreeEnv,
				};
			}

			// Build the dependency.
			let output = await buildCommandOutput(spec.build, buildArg);

			// Filter subdirs if needed.
			if (subdirs !== undefined) {
				output = await std.directory.keepSubdirectories(output, ...subdirs);
			}

			artifactMap[key] = output;
		}

		return artifactMap as ArtifactsFrom<T>;
	};

	/** Input spec for a single dependency - either a build function or full spec with options. */
	export type InputSpec<T extends MinimalPackageArg = MinimalPackageArg> =
		| BuildFn<T>
		| {
				build: BuildFn<T>;
				kind?: Kind;
				when?: Condition;
		  };

	/** Input type for the deps() function. */
	export type Input = {
		// biome-ignore lint/suspicious/noExplicitAny: Build functions are contravariant, requiring type erasure here.
		[key: string]: InputSpec<any>;
	};

	/** Extract the package arg type directly from an InputSpec. */
	type ExtractArgFromInput<T> =
		T extends BuildFn<infer A>
			? A
			: T extends { build: BuildFn<infer A> }
				? A
				: never;

	/** Output type for deps() - maps each key to the appropriate Spec preserving arg types. */
	export type Output<T extends Input> = {
		[K in keyof T]: T[K] extends { kind: Kind }
			? FullSpec & { build: BuildCommand<ExtractArgFromInput<T[K]>> }
			: BuildCommand<ExtractArgFromInput<T[K]>>;
	};
}
