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

/** Evaluate a build function or command with a single package argument. */
export async function buildCommandOutput<T extends MinimalPackageArg>(
	cmd: BuildFn<T> | tg.Command,
	arg: T,
): Promise<tg.Directory> {
	if (typeof cmd === "function") {
		return await (cmd as (...args: Array<T>) => PromiseLike<tg.Directory>)(arg);
	}
	return tg.Directory.expect(await cmd.build(arg));
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

/** Declare dependencies while preserving their build function types for argument inference. */
export function deps<T extends deps.Input>(input: T): T {
	return input;
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

	/** A serialized dependency specification with an opaque build command. */
	export type Spec = {
		build: tg.Command;
		/** The configure arguments this dependency contributes when it is enabled or disabled. */
		flag?: Flag;
		kind: Kind;
		/** The condition that supplies the default when the caller does not override the dependency. */
		when?: Condition;
	};

	/** A mapping of dependency names to their serialized specifications. */
	export type Config = {
		[key: string]: Spec;
	};

	/** A concrete configuration or a command that produces one. */
	export type ConfigArg<T extends Config = Config> = T | tg.Command<[], T>;

	/** Local declarations or a factory that defers their creation. */
	export type InputLike = Input | (() => Input);

	/** Extract the declarations from their optional factory. */
	type ExtractInput<T extends InputLike> = T extends () => infer R ? R : T;

	/** Derive dependency overrides from the actual build functions or command signatures. */
	export type ArgsFrom<T extends Input> = {
		[K in keyof T]?: std.args.OptionalDependencyArg<ArgFromInput<T[K]>>;
	};

	/** The artifacts produced by a configuration, including disabled dependencies. */
	export type ArtifactsFrom<T extends Config> = {
		[K in keyof T]: tg.Directory | undefined;
	};

	/** Infer package dependency arguments from local declarations. */
	export type Arg<T extends InputLike> = {
		dependencies?: ArgsFrom<ExtractInput<T>>;
	};

	/** Construct the commands explicitly before a configuration crosses a value boundary. */
	export async function toConfig<T extends Input>(input: T): Promise<Output<T>> {
		const config: Config = {};
		for (const [key, inputSpec] of Object.entries(input)) {
			const spec =
				typeof inputSpec === "function" || inputSpec instanceof tg.Command
					? { build: inputSpec }
					: inputSpec;
			const build =
				typeof spec.build === "function"
					? (await tg.Command.javascript(spec.build, [])).node
					: spec.build;
			config[key] = {
				build,
				kind: spec.kind ?? "runtime",
				...std.args.optional("flag", spec.flag),
				...std.args.optional("when", spec.when),
			};
		}
		return config as Output<T>;
	}

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
			const { when } = spec;
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
			const { flag } = spec;
			if (flag === undefined) {
				continue;
			}
			args.push(...flagArgsForSpec(key, flag, enabled[key] ?? true));
		}
		return args;
	}

	/** Determine whether a single dependency is enabled. */
	export async function enabled(
		configArg: tg.MaybePromise<ConfigArg>,
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
		configArg: tg.MaybePromise<ConfigArg>,
		ctxArg: ContextArg,
	): Promise<Array<string>> {
		const config = await resolveConfig(configArg);
		if (!config) {
			return [];
		}
		const ctx = context(ctxArg);
		return flagArgs(config, enabledMap(config, ctx));
	}

	/** Obtain a configuration without converting functions into commands. */
	export async function resolveConfig<T extends Config>(
		configArg?: tg.MaybePromise<ConfigArg<T>> | null,
	): Promise<T | undefined> {
		const resolved = await configArg;
		if (resolved === undefined || resolved === null) {
			return undefined;
		}
		const config =
			resolved instanceof tg.Command ? await resolved.build() : resolved;
		for (const [key, spec] of Object.entries(config)) {
			tg.assert(
				spec.build instanceof tg.Command,
				`expected a command for the dependency ${key}`,
			);
		}
		return config;
	}

	/** Resolve a deps config to a combined env. */
	export async function env(
		configArg: tg.MaybePromise<ConfigArg>,
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
		configArg: tg.MaybePromise<ConfigArg<T>>,
		ctxArg: ContextArg,
	): Promise<ArtifactsFrom<T>> {
		const config = await resolveConfig(configArg);
		if (!config) {
			return {} as ArtifactsFrom<T>;
		}
		const ctx = context(ctxArg);
		const { build, host, subtreeEnv, subtreeSdk } = ctx;
		const dependencies = ctx.dependencies ?? {};
		const enabled = enabledMap(config, ctx);
		const artifactMap: Record<string, tg.Directory | undefined> = {};

		for (const [key, spec] of Object.entries(config)) {
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
			let buildArg: { [key: string]: tg.Unresolved<tg.Value> };
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
				const argSubtreeSdk = arg.subtreeSdk ?? subtreeSdk;
				const argSubtreeEnv = arg.subtreeEnv ?? subtreeEnv;
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
			let output = tg.Directory.expect(await spec.build.build(buildArg));

			// Filter subdirs if needed.
			if (subdirs !== undefined) {
				output = await std.directory.keepSubdirectories(output, ...subdirs);
			}

			artifactMap[key] = output;
		}

		return artifactMap as ArtifactsFrom<T>;
	}

	/** A local dependency declaration containing a build function or a command. */
	export type InputSpec<T extends MinimalPackageArg = MinimalPackageArg> =
		| BuildFn<T>
		| tg.Command
		| {
				build: BuildFn<T> | tg.Command;
				flag?: Flag;
				kind?: Kind;
				when?: Condition;
		  };

	/** The local declarations accepted by deps and toConfig. */
	export type Input = {
		// The argument type varies by dependency and is inferred from each declaration.
		[key: string]: InputSpec<any>;
	};

	/** Extract the argument type from an actual function or command signature. */
	type ArgFromBuild<T> = T extends BuildFn<infer A>
		? A
		: T extends tg.Command<infer A>
			? A[number] extends BasePackageArg
				? A[number]
				: BasePackageArg
			: never;

	/** Extract the argument type from a declaration, including its optional metadata. */
	type ArgFromInput<T> = T extends BuildFn<any> | tg.Command
		? ArgFromBuild<T>
		: T extends { build: infer B }
			? ArgFromBuild<B>
			: never;

	/** Preserve dependency names while replacing each declaration with a serialized specification. */
	export type Output<T extends Input> = {
		[K in keyof T]: Spec;
	};
}
