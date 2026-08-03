import * as std from "./tangram.ts";
import {
	type BasePackageArg,
	type PackageArg,
	type DependencyArgs,
} from "./args.tg.ts";

/** Minimal constraint for package arg types. Only requires host for test execution. The host is nullable so that every builder arg satisfies this constraint, because `BasePackageArg` and the builder args all declare `host?: string | null`. */
export type MinimalPackageArg = {
	host?: string | null;
};

/** A function that accepts a variable amount of package args and produces a directory. This is the standard type for the default exports of most packages. */
export type BuildFn<T extends MinimalPackageArg> = (
	...args: tg.Args<T>
) => PromiseLike<tg.Directory>;

/**
 * A tg.Command that builds a package, with phantom type parameter preserving the arg type.
 * Since tg.Command is tg.Object which is tg.Value, this can be included in Arg types.
 */
export type BuildCommand<T extends MinimalPackageArg = MinimalPackageArg> =
	tg.Command & { readonly __packageArg?: T };

/** Evaluate the build function or command with a single arg. Works with both functions and BuildCommands. */
export async function buildCommandOutput<T extends MinimalPackageArg>(
	cmd: BuildFn<T> | BuildCommand<T>,
	arg: T,
): Promise<tg.Directory> {
	if (typeof cmd === "function") {
		return await (cmd as (...args: Array<T>) => PromiseLike<tg.Directory>)(arg);
	}
	return tg.Directory.expect(await (cmd as tg.Command).build(arg));
}

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
	[key: string]: ResolvedPackageArg<BasePackageArg> | boolean | tg.Directory;
};

/** Resolve a dependency's `sdk` field. `"none"` passes through untouched, and anything else resolves to a concrete argument object so that every resolved dependency carries one. */
const resolveDependencySdk = async (
	existing?: std.sdk.Arg | null,
	value?: std.sdk.Arg | null,
): Promise<std.sdk.Arg> => {
	const merged = await std.sdk.mergeArg(existing, value);
	return merged === "none" ? "none" : await std.sdk.arg(merged ?? null);
};

/** Produce a single argument object from a variadic list of arguments with mutation handling. */
export async function applyArgs<T extends PackageArg>(
	...args: tg.Args<T>
): Promise<ResolvedPackageArg<T>> {
	type MergedArg = Omit<BasePackageArg, "dependencies"> & {
		dependencies?: Array<std.args.DependencyArgs | null>;
	};
	const arg = await tg.Args.apply<
		BasePackageArg,
		tg.MaybeMutationMap<MergedArg>,
		MergedArg
	>({
		args: args as tg.Args<BasePackageArg>,
		map: async (arg) => {
			return {
				...arg,
				dependencies: [arg.dependencies ?? null],
			} as unknown as tg.MaybeMutationMap<MergedArg>;
		},
		reduce: {
			dependencies: "append",
			env: (a?: std.env.Arg | null, b?: std.env.Arg | null) =>
				std.env.compose(a ?? null, b ?? null),
			phases: (
				a?: std.phases.PhasesArg | null,
				b?: std.phases.PhasesArg | null,
			) => std.phases.arg(a ?? null, b ?? null),
			sdk: (a?: std.sdk.Arg | null, b?: std.sdk.Arg | null) =>
				std.sdk.mergeArg(a, b),
			subtreeEnv: (a?: std.env.Arg | null, b?: std.env.Arg | null) =>
				std.env.compose(a ?? null, b ?? null),
			subtreeSdk: (a?: std.sdk.Arg | null, b?: std.sdk.Arg | null) =>
				std.sdk.mergeArg(a, b),
		},
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
		if (dependency === undefined || dependency === null) {
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

			// A directory replaces whatever preceded it, in the same way a boolean does. It must be handled before the merge paths below, because spreading a directory would discard it.
			if (value instanceof tg.Directory) {
				resolvedDependencies[key] = value;
				continue;
			}

			const existing = resolvedDependencies[key];
			// A boolean and a directory have no fields to merge, so a later argument object replaces one rather than merging into it.
			if (typeof existing === "boolean" || existing instanceof tg.Directory) {
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
						env: await std.env.compose((value.env as std.env.Arg) ?? null),
						host,
						sdk: await resolveDependencySdk(
							null,
							value.sdk as std.sdk.Arg | undefined,
						),
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
						env: await std.env.compose(
							existing?.env ?? null,
							(value.env as std.env.Arg) ?? null,
						),
						host: existing?.host ?? host,
						sdk: await resolveDependencySdk(
							existing?.sdk,
							value.sdk as std.sdk.Arg | undefined,
						),
					};
				}
			}
		}
	}

	// Omit the optional fields that are unset. An explicit `undefined` is not a
	// tg.Value, so including the key would fail to resolve when the arg is passed
	// to a command.
	return {
		...arg,
		build,
		dependencies: resolvedDependencies,
		...(env !== undefined ? { env } : {}),
		host,
		...(sdk !== undefined ? { sdk } : {}),
		...(subtreeEnv !== undefined ? { subtreeEnv } : {}),
		...(subtreeSdk !== undefined ? { subtreeSdk } : {}),
	} as ResolvedPackageArg<T>;
}

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
			// Full spec with options. The optional fields are omitted when unset, because an explicit `undefined` is not a tg.Value.
			result[key] = {
				build: spec.build as unknown as BuildCommand,
				kind: spec.kind ?? "runtime",
				...(spec.flag !== undefined ? { flag: spec.flag } : {}),
				...(spec.when !== undefined ? { when: spec.when } : {}),
			};
		}
	}
	return result as deps.Output<T>;
}

export namespace deps {
	/** The kind of dependency relationship. */
	export type Kind = "runtime" | "buildtime" | "full";

	/**
	 * A declarative predicate over the resolution context that determines whether a dependency is included by default.
	 *
	 * A dependency configuration is produced by a Tangram command, so it must be representable as a tg.Value. A closure cannot cross that boundary, because `tg.resolve` converts a function to a command whose export name is derived from the function name. A condition is therefore plain data that `evaluateCondition` interprets.
	 *
	 * A condition object must have exactly one key. Use `all` or `any` to combine several conditions.
	 */
	export type Condition =
		| { all: Array<Condition> }
		| { any: Array<Condition> }
		| { buildArch: string | Array<string> }
		| { buildOs: string | Array<string> }
		| { cross: boolean }
		| { hostArch: string | Array<string> }
		| { hostOs: string | Array<string> }
		| { not: Condition };

	/** The two conventional autotools option pairs. The dependency key supplies the option name. */
	export type FlagShorthand = "enable" | "with";

	/** An explicit description of the configure arguments a dependency contributes. */
	export type FlagSpec = {
		/** The arguments to add when the dependency is disabled. When this field is present it replaces the arguments derived from `with` or `enable`. Use an empty array for a configure script that accepts the positive option but rejects the negative one. */
		disabled?: Array<string>;

		/** Produce `--enable-<name>` when the dependency is enabled and `--disable-<name>` when it is disabled. */
		enable?: string;

		/** The arguments to add when the dependency is enabled. When this field is present it replaces the arguments derived from `with` or `enable`. */
		enabled?: Array<string>;

		/** Produce `--with-<name>` when the dependency is enabled and `--without-<name>` when it is disabled. */
		with?: string;
	};

	/** How a dependency maps onto configure arguments. */
	export type Flag = FlagShorthand | FlagSpec;

	/** Full specification for a single dependency using BuildCommand. */
	export type FullSpec = {
		// biome-ignore lint/suspicious/noExplicitAny: Package commands are contravariant, requiring type erasure here.
		build: BuildCommand<any>;
		/** The configure arguments this dependency contributes when it is enabled or disabled. */
		flag?: Flag;
		kind: Kind;
		/** The condition that decides whether this dependency is included by default. An explicit entry in the caller's `dependencies` overrides it. */
		when?: Condition;
	};

	/** Specification for a single dependency - either a BuildCommand (defaults to runtime) or full spec. */
	// biome-ignore lint/suspicious/noExplicitAny: Package commands are contravariant, requiring type erasure here.
	export type Spec = BuildCommand<any> | FullSpec;

	/** Normalize a Spec to a FullSpec. */
	export function normalizeSpec(spec: Spec): FullSpec {
		// A FullSpec has a 'kind' property; a plain BuildCommand does not.
		if ("kind" in spec) {
			return spec as FullSpec;
		}
		return { build: spec as BuildCommand, kind: "runtime" };
	}

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
		dependencies?: std.args.DependencyArgs;
		env?: tg.Unresolved<std.env.Arg>;
		/** Environment to propagate to all dependencies in the subtree. */
		subtreeEnv?: tg.Unresolved<std.env.Arg>;
		/** SDK configuration to propagate to all dependencies in the subtree. */
		subtreeSdk?: std.sdk.Arg;
	};

	/**
	 * The input accepted wherever a resolution context is required.
	 *
	 * The resolved argument of every builder satisfies this shape, so the argument may be passed directly without reconstructing a context. `Context` differs only in rejecting `null`, so every `Context` is also a `ContextArg`.
	 */
	export type ContextArg = {
		build: string;
		/** Dependency argument overrides from user input. The build and host fields are added automatically. */
		dependencies?: std.args.DependencyArgs | null;
		env?: tg.Unresolved<std.env.Arg> | null;
		host: string;
		sdk?: std.sdk.Arg | null;
		/** Environment to propagate to all dependencies in the subtree. */
		subtreeEnv?: tg.Unresolved<std.env.Arg> | null;
		/** SDK configuration to propagate to all dependencies in the subtree. */
		subtreeSdk?: std.sdk.Arg | null;
	};

	/** Normalize a builder argument into a context, dropping the fields that are null or unset. */
	export function context(arg: ContextArg): Context {
		const { build, dependencies, env, host, sdk, subtreeEnv, subtreeSdk } = arg;
		return {
			build,
			host,
			...std.args.optional("dependencies", dependencies),
			...std.args.optional("env", env),
			...std.args.optional("sdk", sdk),
			...std.args.optional("subtreeEnv", subtreeEnv),
			...std.args.optional("subtreeSdk", subtreeSdk),
		};
	}

	/** Determine whether a value matches a condition operand, which may name a single value or a set of them. */
	function matches(operand: string | Array<string>, value: string): boolean {
		return Array.isArray(operand) ? operand.includes(value) : operand === value;
	}

	/** Evaluate a condition against a context. */
	export function evaluateCondition(
		condition: Condition,
		ctx: { build: string; host: string },
	): boolean {
		if ("all" in condition) {
			return condition.all.every((inner) => evaluateCondition(inner, ctx));
		}
		if ("any" in condition) {
			return condition.any.some((inner) => evaluateCondition(inner, ctx));
		}
		if ("buildArch" in condition) {
			return matches(condition.buildArch, std.triple.arch(ctx.build));
		}
		if ("buildOs" in condition) {
			return matches(condition.buildOs, std.triple.os(ctx.build));
		}
		if ("cross" in condition) {
			return condition.cross === (ctx.build !== ctx.host);
		}
		if ("hostArch" in condition) {
			return matches(condition.hostArch, std.triple.arch(ctx.host));
		}
		if ("hostOs" in condition) {
			return matches(condition.hostOs, std.triple.os(ctx.host));
		}
		if ("not" in condition) {
			return !evaluateCondition(condition.not, ctx);
		}
		return tg.unreachable(
			`unrecognized condition: ${JSON.stringify(condition)}`,
		);
	}

	/**
	 * Determine whether each dependency in a configuration is enabled.
	 *
	 * An explicit entry in the caller's `dependencies` decides. A `when` condition only supplies the default for a dependency the caller did not mention.
	 */
	export function enabledMap(
		config: Config,
		ctx: Context,
	): { [key: string]: boolean } {
		const dependencies = ctx.dependencies ?? {};
		const result: { [key: string]: boolean } = {};
		for (const [key, spec] of Object.entries(config)) {
			const arg = dependencies[key];
			if (arg === false) {
				result[key] = false;
				continue;
			}
			if (arg !== undefined) {
				result[key] = true;
				continue;
			}
			const { when } = normalizeSpec(spec);
			result[key] = when === undefined ? true : evaluateCondition(when, ctx);
		}
		return result;
	}

	/** Produce the configure arguments implied by a single flag. */
	function flagArgsForSpec(
		key: string,
		flag: Flag,
		on: boolean,
	): Array<string> {
		if (typeof flag === "string") {
			const prefix =
				flag === "with" ? (on ? "with" : "without") : on ? "enable" : "disable";
			return [`--${prefix}-${key}`];
		}
		const explicit = on ? flag.enabled : flag.disabled;
		if (explicit !== undefined) {
			return explicit;
		}
		if (flag.with !== undefined) {
			return [`--${on ? "with" : "without"}-${flag.with}`];
		}
		if (flag.enable !== undefined) {
			return [`--${on ? "enable" : "disable"}-${flag.enable}`];
		}
		return [];
	}

	/** Produce the configure arguments contributed by the dependencies that declare a flag, in declaration order. Dependencies without a flag contribute nothing. */
	export function flagArgs(
		config: Config,
		enabled: { [key: string]: boolean },
	): Array<string> {
		const args: Array<string> = [];
		for (const [key, spec] of Object.entries(config)) {
			const { flag } = normalizeSpec(spec);
			if (flag === undefined) {
				continue;
			}
			args.push(...flagArgsForSpec(key, flag, enabled[key] ?? true));
		}
		return args;
	}

	/** Determine whether a single dependency is enabled. */
	export async function enabled(
		configArg: tg.Unresolved<ConfigArg>,
		ctxArg: ContextArg,
		key: string,
	): Promise<boolean> {
		const config = await resolveConfig(configArg);
		if (!config) {
			return false;
		}
		return enabledMap(config, context(ctxArg))[key] ?? false;
	}

	/** Produce the configure arguments implied by which dependencies are enabled. */
	export async function configureArgs(
		configArg: tg.Unresolved<ConfigArg>,
		ctxArg: ContextArg,
	): Promise<Array<string>> {
		const config = await resolveConfig(configArg);
		if (!config) {
			return [];
		}
		const ctx = context(ctxArg);
		return flagArgs(config, enabledMap(config, ctx));
	}

	/** Resolve a ConfigArg to a Config. */
	export async function resolveConfig(
		configArg?: tg.Unresolved<ConfigArg> | null,
	): Promise<Config | undefined> {
		if (configArg === undefined || configArg === null) {
			return undefined;
		}
		const resolved = await tg.resolve(configArg);
		if (resolved instanceof tg.Command) {
			return (await resolved.build()) as Config;
		}
		return resolved as Config;
	}

	/** Resolve a deps config to a combined env. */
	export async function env(
		configArg: tg.Unresolved<ConfigArg>,
		ctxArg: ContextArg,
	): Promise<std.env.EnvObject> {
		const ctx = context(ctxArg);
		const config = await resolveConfig(configArg);
		if (!config) {
			return std.env.arg(ctx.env ?? null);
		}
		const artifactMap = await artifacts(config, ctx);
		const artifactList = Object.values(artifactMap).filter(
			(v): v is tg.Directory => v !== undefined,
		);
		return std.env.arg(...artifactList, ctx.env ?? null);
	}

	/** Resolve a deps config to individual artifacts by name. */
	export async function artifacts<T extends Config>(
		configArg: tg.Unresolved<T | ConfigArg>,
		ctxArg: ContextArg,
	): Promise<ArtifactsFrom<T>> {
		const config = (await resolveConfig(
			configArg as tg.Unresolved<ConfigArg>,
		)) as T;
		if (!config) {
			return {} as ArtifactsFrom<T>;
		}
		const ctx = context(ctxArg);
		const { build, host, subtreeEnv, subtreeSdk } = ctx;
		const dependencies = ctx.dependencies ?? {};
		const enabled = enabledMap(config, ctx);
		const artifactMap: Record<string, tg.Directory | undefined> = {};

		for (const [key, spec_] of Object.entries(config)) {
			const spec = normalizeSpec(spec_);
			const arg = dependencies[key];

			// Skip the dependencies the caller disabled and those excluded by their condition.
			if (!enabled[key]) {
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

			// A directory supplied by the caller replaces the dependency's build. The kind still selects which subdirectories are kept, so that an injected artifact contributes the same shape as a built one.
			if (arg instanceof tg.Directory) {
				artifactMap[key] =
					subdirs !== undefined
						? await std.directory.keepSubdirectories(arg, ...subdirs)
						: arg;
				continue;
			}

			// Prepare build argument.
			// Dependencies receive subtreeSdk as their sdk, and subtree* propagate down.
			// Plain sdk/env do NOT inherit to dependencies.
			const host_ = setHostToBuild ? build : host;
			let buildArg: Record<string, unknown>;
			if (arg === undefined || typeof arg === "boolean") {
				buildArg = {
					build,
					host: host_,
					sdk: subtreeSdk ?? {},
					...(subtreeSdk !== undefined ? { subtreeSdk } : {}),
					...(subtreeEnv !== undefined ? { subtreeEnv } : {}),
				};
			} else {
				// When user provides custom sdk for a dependency, merge with subtreeSdk.
				const argSdk = arg.sdk as std.sdk.Arg | undefined;
				const mergedSdk = argSdk
					? ((await std.sdk.mergeArg(subtreeSdk, argSdk)) ?? {})
					: (subtreeSdk ?? {});
				// Allow the dependency to override the subtree values, otherwise propagate.
				const argSubtreeSdk =
					(arg as Record<string, unknown>).subtreeSdk ?? subtreeSdk;
				const argSubtreeEnv =
					(arg as Record<string, unknown>).subtreeEnv ?? subtreeEnv;
				buildArg = {
					...arg,
					build,
					host: host_,
					sdk: mergedSdk,
					...(argSubtreeSdk !== undefined ? { subtreeSdk: argSubtreeSdk } : {}),
					...(argSubtreeEnv !== undefined ? { subtreeEnv: argSubtreeEnv } : {}),
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
	}

	/** Input spec for a single dependency - either a build function or full spec with options. */
	export type InputSpec<T extends MinimalPackageArg = MinimalPackageArg> =
		| BuildFn<T>
		| {
				build: BuildFn<T>;
				/** The configure arguments this dependency contributes when it is enabled or disabled. */
				flag?: Flag;
				kind?: Kind;
				/** The condition that decides whether this dependency is included by default. An explicit entry in the caller's `dependencies` overrides it. */
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
