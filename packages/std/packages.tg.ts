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
	"build" | "env" | "host" | "sdk" | "dependencies"
> & {
	build: string;
	dependencies?: ResolvedDependencyArgs;
	env?: std.env.Arg;
	host: string;
	sdk: std.sdk.Arg;
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
				std.phases.mergePhases(a, b),
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
	} as ResolvedPackageArg<T>;
};

/**
 * Wrap build functions as BuildCommands to create a deps Config.
 * Accepts either plain build functions or full specs with kind option.
 */
export async function deps<T extends deps.Input>(
	input: T,
): Promise<deps.Output<T>> {
	const result: Record<string, deps.Spec> = {};
	for (const [key, spec] of Object.entries(input)) {
		if (typeof spec === "function") {
			// Simple case: just a build function
			const cmd = await tg.command(spec);
			result[key] = cmd as BuildCommand;
		} else {
			// Full spec with options
			const cmd = await tg.command(spec.build);
			result[key] = {
				build: cmd as BuildCommand,
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

	/**
	 * Internal full spec that includes condition (not stored in Config, used during resolution).
	 */
	export type FullSpecWithCondition = FullSpec & {
		when?: Condition;
	};

	/** Normalize a Spec to a FullSpec. */
	export const normalizeSpec = (spec: Spec): FullSpec => {
		// A FullSpec has a 'kind' property; a plain BuildCommand does not.
		if ("kind" in spec) {
			return spec as FullSpec;
		}
		return { build: spec as BuildCommand, kind: "runtime" };
	};

	/**
	 * A mapping of dependency names to their specifications.
	 * Since BuildCommand is tg.Command (tg.Object -> tg.Value), this type IS tg.Value
	 * and can be included directly in Arg types.
	 */
	export type Config = {
		[key: string]: Spec;
	};

	/** Extract the Arg type from a BuildCommand. */
	type ExtractPackageArg<T> = T extends BuildCommand<infer A> ? A : never;

	/** Extract the BuildCommand from a Spec. */
	type ExtractBuild<T extends Spec> = T extends FullSpec
		? T["build"]
		: // biome-ignore lint/suspicious/noExplicitAny: Package commands are contravariant, requiring type erasure here.
			T extends BuildCommand<any>
			? T
			: never;

	/** Generate a dependencies type from a Config. */
	export type ArgsFrom<T extends Config> = {
		[K in keyof T]?: std.args.OptionalDependencyArg<
			ExtractPackageArg<ExtractBuild<T[K]>>
		>;
	};

	/** Generate an artifacts map type from a Config. */
	export type ArtifactsFrom<T extends Config> = {
		[K in keyof T]: tg.Directory | undefined;
	};

	/** Extract the dependencies Arg type from a deps Config. */
	export type Arg<T extends Config> = { dependencies?: ArgsFrom<T> };

	/** Context required for deps resolution. */
	export type Context = {
		build: string;
		host: string;
		sdk?: std.sdk.Arg;
		/** Dependency argument overrides from user input. build/host are added automatically. */
		dependencies?: std.args.DependencyArgs | undefined;
		env?: tg.Unresolved<std.env.Arg>;
	};

	/** Resolve a deps config to a combined env. */
	export const env = async (
		config: Config,
		ctx: Context,
	): Promise<std.env.EnvObject> => {
		const artifactMap = await artifacts(config, ctx);
		const artifactList = Object.values(artifactMap).filter(
			(v): v is tg.Directory => v !== undefined,
		);
		return std.env.arg(...artifactList, ctx.env);
	};

	/** Resolve a deps config to individual artifacts by name. */
	export const artifacts = async <T extends Config>(
		config: T,
		ctx: Context,
	): Promise<ArtifactsFrom<T>> => {
		const { build, host, sdk, dependencies = {} } = ctx;
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
			const inheritSdk = spec.kind === "runtime";
			const subdirs =
				spec.kind === "buildtime"
					? ["bin"]
					: spec.kind === "runtime"
						? ["include", "lib"]
						: undefined;

			// Prepare build argument.
			const host_ = setHostToBuild ? build : host;
			let buildArg: Record<string, unknown> =
				arg === true || arg === undefined
					? { build, host: host_, sdk: {} }
					: { ...arg, build, host: host_ };

			if (inheritSdk) {
				buildArg = { ...buildArg, sdk };
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

	/** Extract the build function from an InputSpec. */
	type ExtractInputBuildFn<T> =
		T extends BuildFn<infer A>
			? BuildFn<A>
			: T extends { build: BuildFn<infer A> }
				? BuildFn<A>
				: never;

	/** Output type for deps() - maps each key to the appropriate Spec preserving arg types. */
	export type Output<T extends Input> = {
		[K in keyof T]: ExtractInputBuildFn<T[K]> extends BuildFn<infer A>
			? T[K] extends { kind: Kind }
				? FullSpec & { build: BuildCommand<A> }
				: BuildCommand<A>
			: never;
	};
}
