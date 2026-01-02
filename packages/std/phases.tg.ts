import * as std from "./tangram.ts";

/** Helper for constructing multi-phase build targets. */

/** Argument type for arg() - purely phases. Symmetric with std.sdk.Arg, std.env.Arg, etc. */
export type Arg = PhasesArg;

/** Argument type for run() - execution metadata plus phases. */
export type RunArg = {
	bootstrap?: boolean | undefined;
	debug?: boolean | undefined;
	env?: std.env.Arg | undefined;
	order?: Array<string> | undefined;
	phases?: PhasesArg | undefined;
	processName?: string | undefined;
	checksum?: tg.Checksum | undefined;
	network?: boolean | undefined;
	command?: tg.Command.Arg.Object | undefined;
};

/** Resolved phases after merging. */
export type Phases = {
	[key: string]: Phase;
};

export type PhasesArg =
	| {
			[key: string]: PhaseArg;
	  }
	| undefined;

/** A phase body that is a complete script. Composable via prefix/suffix mutations. */
export type ScriptBody = tg.Template;

/** A phase body with structured command and args. Args are composable via append. */
export type CommandBody = {
	command: tg.Template;
	args?: Array<tg.Template> | undefined;
};

/** Resolved phase after merging. */
export type Phase = {
	body: ScriptBody | CommandBody;
	pre?: ScriptBody | CommandBody | undefined;
	post?: ScriptBody | CommandBody | undefined;
};

/** Input for a script body. */
export type ScriptBodyArg = tg.Template.Arg;

/** Input for a command body. */
export type CommandBodyArg = {
	command?: tg.Template.Arg | tg.Mutation<tg.Template.Arg>;
	args?: Array<tg.Template.Arg> | tg.Mutation | undefined;
};

/** Alias for backward compatibility. */
export type CommandArg = BodyArg | undefined;

/** Input for a phase body - either script or command form. Also accepts resolved bodies. */
export type BodyArg =
	| ScriptBodyArg
	| ScriptBody
	| CommandBodyArg
	| CommandBody
	| tg.Mutation<tg.Template.Arg>;

/** Input for a phase - can specify body directly or with pre/post hooks. */
export type PhaseArg = BodyArg | PhaseArgObject | tg.Mutation<BodyArg>;

/** Input for a phase with explicit body/pre/post structure. */
export type PhaseArgObject = {
	body?: BodyArg;
	pre?: BodyArg;
	post?: BodyArg;
};

/** Construct a script and run it. */
export const run = async (...args: std.Args<RunArg>) => {
	// Merge execution metadata. The reducer for phases calls arg() which returns Phases.
	const runArg = await std.args.apply<RunArg, RunArg>({
		args,
		map: async (a) => a ?? {},
		reduce: {
			command: "merge",
			env: (a, b) => std.env.arg(a, b, { utils: false }),
			phases: (a, b) => arg(a, b),
		},
	});

	const {
		bootstrap = false,
		checksum,
		network = false,
		debug,
		env: env_,
		order: order_,
		processName,
		command: commandArg,
	} = runArg;

	// The reducer for phases calls arg() which returns Phases.
	// TypeScript doesn't track this, so we need a helper to safely convert.
	const phases = resolvePhases(runArg.phases);

	// Construct the phases in order.
	// FIXME: This is a hack to avoid the 0: Bad file descriptor in configure scripts on Linux.`
	const empty = tg.template("exec 0</dev/null");
	// let empty = tg.template();
	const order = order_ ?? defaultOrder();
	let script = empty;
	if (debug) {
		script = tg`${empty}
		set -x
		set +e
		export LOGDIR=${tg.output}/.tangram_logs
		mkdir -p "$LOGDIR"
		export buildlog=$LOGDIR/build.log
		start=$(date +%s)
		echo "Running phases: ${order.join(", ")}\n" | tee "$buildlog"`;
	} else {
		script = empty;
	}
	if (phases !== undefined) {
		script = order.reduce(async (ret, phaseName) => {
			const phase = phases[phaseName];
			// Skip undefined phases.
			if (phase === undefined) {
				return ret;
			}
			const phaseTemplate = await constructPhaseTemplate(phase);
			if (
				phaseTemplate.components.length === 0 ||
				phaseTemplate.components[0] === ""
			) {
				return ret;
			} else {
				if (debug) {
					ret = tg`${ret}
					${phaseName}_start=$(date +%s)
					${phaseName}_log=$LOGDIR/${phaseName}_phase.log
					echo "Running ${phaseName} phase:" | tee -a "$buildlog"
					echo "${phaseTemplate}" | tee -a "$buildlog"
					echo "${phaseTemplate}" | tee "$${phaseName}_log"
					echo "----------------------------------------" | tee -a "$${phaseName}_log"
					(${phaseTemplate}) 2>&1 | tee -a "$${phaseName}_log"
					${phaseName}_end=$(date +%s)
					${phaseName}_duration=$(( ${phaseName}_end - ${phaseName}_start ))
					echo "${phaseName} phase completed in $${phaseName}_duration seconds" | tee -a "$buildlog"
					echo "----------------------------------------" | tee -a "$buildlog"
					`;
				} else {
					ret = tg`${ret}\n${phaseTemplate}`;
				}
				return ret;
			}
		}, script);
	}
	if (debug) {
		script = tg`${script}
		end=$(date +%s)
		duration=$(( end - start ))
		echo "Build completed in $duration seconds" | tee -a "$buildlog"
		`;
	}

	let builder = std.run`${script}`.env(env_);
	if (commandArg !== undefined) {
		builder = builder.arg(commandArg);
	}
	if (bootstrap) {
		builder = builder.bootstrap(bootstrap);
	}
	if (checksum) {
		builder = builder.checksum(checksum);
	}
	if (processName !== undefined) {
		builder = builder.named(processName);
	}
	if (network) {
		builder = builder.network(network);
	}
	return await builder;
};

/**
 * Type guard to check if a value is a resolved Phase.
 * A Phase has a body field that is a Template (ScriptBody) or has a command field (CommandBody).
 */
const isPhase = (value: unknown): value is Phase => {
	if (typeof value !== "object" || value === null) return false;
	if (!("body" in value)) return false;
	const valueWithBody = value;
	const body = valueWithBody.body;
	// ScriptBody is a Template, CommandBody has a command field that is a Template.
	if (body instanceof tg.Template) return true;
	if (typeof body !== "object" || body === null) return false;
	if (!("command" in body)) return false;
	const bodyWithCommand = body;
	return bodyWithCommand.command instanceof tg.Template;
};

/**
 * Convert PhasesArg to Phases.
 * After std.args.apply with the phases reducer, the phases field contains resolved Phases,
 * but TypeScript still types it as PhasesArg. This helper safely converts the type.
 */
const resolvePhases = (phasesArg: PhasesArg | undefined): Phases => {
	if (phasesArg === undefined) return {};
	const phases: Phases = {};
	for (const key of Object.keys(phasesArg)) {
		const value = phasesArg[key];
		if (isPhase(value)) {
			phases[key] = value;
		}
	}
	return phases;
};

/**
 * Type predicate to validate a value is a PhaseArg.
 * This is needed because tg.resolve() doesn't fully narrow types.
 */
const isPhaseArg = (value: unknown): value is PhaseArg => {
	if (value === undefined) return false;
	// Mutation is a valid PhaseArg.
	if (value instanceof tg.Mutation) return true;
	// Template (ScriptBodyArg/ScriptBody) is valid.
	if (value instanceof tg.Template) return true;
	// Artifact is valid (part of ScriptBodyArg).
	if (tg.Artifact.is(value)) return true;
	// String is valid (part of ScriptBodyArg).
	if (typeof value === "string") return true;
	// Object with command/args (CommandBodyArg/CommandBody) is valid.
	if (typeof value === "object" && value !== null) {
		if ("command" in value || "args" in value) return true;
		// Object with body/pre/post (PhaseArgObject) is valid.
		if ("body" in value || "pre" in value || "post" in value) return true;
	}
	return false;
};

/** Merge phase arguments. Symmetric with std.sdk.arg, std.env.arg, etc. */
export const arg = async (
	...args: Array<tg.Unresolved<Arg | Array<Arg>>>
): Promise<Phases> => {
	const phases: Phases = {};

	// Process a single PhasesArg, merging its phases into the accumulated result.
	const processPhasesArg = async (phasesArg: PhasesArg) => {
		if (phasesArg === undefined) return;
		// Iterate over the phases and merge each one.
		for (const key of Object.keys(phasesArg)) {
			const rawValue = phasesArg[key];
			// Validate the value is a PhaseArg (needed because tg.resolve types are wide).
			if (!isPhaseArg(rawValue)) continue;
			const existing = phases[key];
			const mergedPhase = await mergePhaseArgs(existing, rawValue);
			if (mergedPhase !== undefined) {
				phases[key] = mergedPhase;
			} else {
				delete phases[key];
			}
		}
	};

	for (const unresolvedArg of args) {
		const resolved = await tg.resolve(unresolvedArg);
		// Handle arrays by processing each element in order.
		if (Array.isArray(resolved)) {
			for (const element of resolved) {
				await processPhasesArg(element);
			}
		} else {
			await processPhasesArg(resolved);
		}
	}
	return phases;
};

export const defaultOrder = () => [
	"prepare",
	"configure",
	"build",
	"check",
	"install",
	"fixup",
];

/** Check if arg is a script body arg (template-like). */
export const isScriptBodyArg = (arg: unknown): arg is ScriptBodyArg => {
	return (
		typeof arg === "string" || arg instanceof tg.Template || tg.Artifact.is(arg)
	);
};

/** Check if arg is a command body arg (has command or args fields). */
export const isCommandBodyArg = (arg: unknown): arg is CommandBodyArg => {
	return (
		arg !== undefined &&
		arg !== null &&
		typeof arg === "object" &&
		!(arg instanceof tg.Template) &&
		!(arg instanceof tg.Mutation) &&
		!tg.Artifact.is(arg) &&
		("command" in arg || "args" in arg)
	);
};

/** Check if arg is a body arg (script, command, or mutation). */
export const isBodyArg = (arg: unknown): arg is BodyArg => {
	return (
		isScriptBodyArg(arg) || isCommandBodyArg(arg) || arg instanceof tg.Mutation
	);
};

/** Check if arg is a phase arg object with body/pre/post structure. */
export const isPhaseArgObject = (arg: unknown): arg is PhaseArgObject => {
	return (
		arg !== undefined &&
		arg !== null &&
		typeof arg === "object" &&
		!(arg instanceof tg.Template) &&
		!(arg instanceof tg.Mutation) &&
		!tg.Artifact.is(arg) &&
		!isCommandBodyArg(arg) &&
		("body" in arg || "pre" in arg || "post" in arg)
	);
};

/** Check if a resolved body is a script (template). */
export const isScriptBody = (
	body: ScriptBody | CommandBody,
): body is ScriptBody => {
	return body instanceof tg.Template;
};

/** Check if a resolved body is a command (has command field). */
export const isCommandBody = (
	body: ScriptBody | CommandBody,
): body is CommandBody => {
	return (
		typeof body === "object" &&
		body !== null &&
		!(body instanceof tg.Template) &&
		"command" in body &&
		body.command instanceof tg.Template
	);
};

/** Internal type for phase arg processing. */
type PhaseArgIntermediate = {
	body?: BodyArg;
	pre?: BodyArg;
	post?: BodyArg;
};

/** Convert a PhaseArg to PhaseArgIntermediate. */
const toPhaseArgIntermediate = (
	arg: PhaseArg | undefined,
): PhaseArgIntermediate | "unset" | "set_if_unset" => {
	if (arg === undefined) {
		return {};
	} else if (arg instanceof tg.Mutation) {
		if (arg.inner.kind === "unset") {
			return "unset";
		} else if (arg.inner.kind === "set") {
			// Unwrap the set mutation and process the inner value.
			const inner = arg.inner.value;
			if (inner === undefined) {
				return {};
			} else if (isPhaseArgObject(inner)) {
				return inner;
			} else if (isBodyArg(inner)) {
				return { body: inner };
			} else {
				throw new Error(`Unexpected value in set mutation: ${inner}`);
			}
		} else if (arg.inner.kind === "set_if_unset") {
			// Return marker so we can handle set_if_unset at the phase level.
			return "set_if_unset";
		} else if (arg.inner.kind === "prefix" || arg.inner.kind === "suffix") {
			// prefix/suffix mutations apply to the body.
			return { body: arg as tg.Mutation<tg.Template.Arg> };
		} else {
			throw new Error(`Unexpected mutation kind for phase: ${arg.inner.kind}`);
		}
	} else if (isPhaseArgObject(arg)) {
		return arg;
	} else if (isBodyArg(arg)) {
		return { body: arg };
	} else {
		throw new Error(`Unexpected phase arg type: ${arg}`);
	}
};

/** Extract the inner value from a set_if_unset mutation. */
const extractSetIfUnsetValue = (arg: PhaseArg): PhaseArgIntermediate => {
	if (!(arg instanceof tg.Mutation) || arg.inner.kind !== "set_if_unset") {
		throw new Error("Expected set_if_unset mutation");
	}
	const inner = arg.inner.value;
	if (inner === undefined) {
		return {};
	} else if (isPhaseArgObject(inner)) {
		return inner;
	} else if (isBodyArg(inner)) {
		return { body: inner };
	} else {
		throw new Error(`Unexpected value in set_if_unset mutation: ${inner}`);
	}
};

/** Merge phase args into a resolved Phase. */
export const mergePhaseArgs = async (
	...args: Array<tg.Unresolved<PhaseArg>>
): Promise<Phase | undefined> => {
	const resolved = await Promise.all(args.map(tg.resolve));

	// Merge the phase arg objects, tracking state for set_if_unset.
	let body: ScriptBody | CommandBody | undefined;
	let pre: ScriptBody | CommandBody | undefined;
	let post: ScriptBody | CommandBody | undefined;
	let hasContent = false;

	for (let i = 0; i < resolved.length; i++) {
		const arg = resolved[i];
		const intermediate = toPhaseArgIntermediate(arg);

		if (intermediate === "unset") {
			// Unset clears the phase entirely.
			return undefined;
		} else if (intermediate === "set_if_unset") {
			// Only apply if no content has been set yet.
			if (!hasContent) {
				const value = extractSetIfUnsetValue(arg as PhaseArg);
				if (value.body !== undefined) {
					body = await mergeBodyArgs(body, value.body);
					hasContent = true;
				}
				if (value.pre !== undefined) {
					pre = await mergeBodyArgs(pre, value.pre);
					hasContent = true;
				}
				if (value.post !== undefined) {
					post = await mergeBodyArgs(post, value.post);
					hasContent = true;
				}
			}
			// If hasContent is true, skip the set_if_unset.
		} else {
			// Regular phase arg - merge it.
			if (intermediate.body !== undefined) {
				body = await mergeBodyArgs(body, intermediate.body);
				hasContent = true;
			}
			if (intermediate.pre !== undefined) {
				pre = await mergeBodyArgs(pre, intermediate.pre);
				hasContent = true;
			}
			if (intermediate.post !== undefined) {
				post = await mergeBodyArgs(post, intermediate.post);
				hasContent = true;
			}
		}
	}

	// Allow phases with only pre/post hooks (no body) - they will merge with builder defaults.
	if (body === undefined && pre === undefined && post === undefined) {
		return undefined;
	}

	// Create a phase. If body is undefined, use an empty template as placeholder.
	// The builder will replace this with its default when merging.
	const finalBody = body ?? (await tg.template(""));
	return { body: finalBody, pre, post };
};

/** Handle prefix mutation on a body. */
const handlePrefix = async (
	existing: ScriptBody | CommandBody | undefined,
	template: tg.Template,
	separator: string,
): Promise<ScriptBody> => {
	if (existing === undefined) {
		return template;
	} else if (isScriptBody(existing)) {
		return tg.Template.join(separator, template, existing);
	} else {
		// Convert command to script, then prefix.
		const script = await constructBodyTemplate(existing);
		return tg.Template.join(separator, template, script);
	}
};

/** Handle suffix mutation on a body. */
const handleSuffix = async (
	existing: ScriptBody | CommandBody | undefined,
	template: tg.Template,
	separator: string,
): Promise<ScriptBody> => {
	if (existing === undefined) {
		return template;
	} else if (isScriptBody(existing)) {
		return tg.Template.join(separator, existing, template);
	} else {
		// Convert command to script, then suffix.
		const script = await constructBodyTemplate(existing);
		return tg.Template.join(separator, script, template);
	}
};

/** Merge two command bodies. */
const mergeCommandBodies = async (
	existing: CommandBody,
	arg: CommandBodyArg,
): Promise<CommandBody> => {
	const result: CommandBody = { command: existing.command };
	if (existing.args !== undefined) {
		result.args = [...existing.args];
	}

	// Command: resolve with existing for mutation support.
	if (arg.command !== undefined) {
		result.command = await resolveCommandField(arg.command, existing.command);
	}

	// Args: handle mutation or append.
	if (arg.args !== undefined) {
		if (arg.args instanceof tg.Mutation) {
			// Apply mutation to args.
			if (arg.args.inner.kind === "unset") {
				result.args = undefined;
			} else {
				throw new Error(
					`Unexpected mutation kind for args: ${arg.args.inner.kind}`,
				);
			}
		} else {
			const newArgs = await Promise.all(arg.args.map((a) => tg.template(a)));
			result.args = result.args ? [...result.args, ...newArgs] : newArgs;
		}
	}

	return result;
};

/**
 * Merge body args into a resolved ScriptBody or CommandBody.
 *
 * Composition rules:
 * - Script + Script: prefix/suffix mutations compose, otherwise replaces.
 * - Command + Command: args append by default, command replaces.
 * - Command + Script: converts to script (replaces).
 * - Script + { args: [...] }: converts to command with args.
 */
export const mergeBodyArgs = async (
	existing: ScriptBody | CommandBody | undefined,
	arg: BodyArg,
): Promise<ScriptBody | CommandBody> => {
	// Handle mutations.
	if (arg instanceof tg.Mutation) {
		if (arg.inner.kind === "unset") {
			throw new Error(
				"Use tg.Mutation.unset() at the phase level, not body level.",
			);
		} else if (arg.inner.kind === "set") {
			return resolveBodyArg(arg.inner.value);
		} else if (arg.inner.kind === "set_if_unset") {
			if (existing !== undefined) {
				return existing;
			}
			return resolveBodyArg(arg.inner.value);
		} else if (arg.inner.kind === "prefix") {
			return handlePrefix(
				existing,
				arg.inner.template,
				arg.inner.separator ?? "",
			);
		} else if (arg.inner.kind === "suffix") {
			return handleSuffix(
				existing,
				arg.inner.template,
				arg.inner.separator ?? "",
			);
		} else {
			throw new Error(`Unexpected mutation kind for body: ${arg.inner.kind}`);
		}
	}

	// Handle script body arg (template-like).
	if (isScriptBodyArg(arg)) {
		return tg.template(arg);
	}

	// Handle command body arg.
	if (isCommandBodyArg(arg)) {
		if (existing === undefined) {
			return resolveCommandBodyArg(arg);
		} else if (isScriptBody(existing)) {
			// Script + command: if command provided, replace. Otherwise convert script to command with args.
			if (arg.command !== undefined) {
				return resolveCommandBodyArg(arg);
			} else {
				const resolvedArgs = await resolveArgsField(arg.args);
				return { command: existing, args: resolvedArgs };
			}
		} else {
			return mergeCommandBodies(existing, arg);
		}
	}

	throw new Error(`Unexpected body arg: ${arg}`);
};

/** Resolve args field which may be an array or a mutation. */
const resolveArgsField = async (
	args: Array<tg.Template.Arg> | tg.Mutation | undefined,
): Promise<Array<tg.Template> | undefined> => {
	if (args === undefined) {
		return undefined;
	}
	if (args instanceof tg.Mutation) {
		if (args.inner.kind === "unset") {
			return undefined;
		}
		if (args.inner.kind === "set") {
			const value = args.inner.value;
			tg.assert(
				Array.isArray(value),
				"Expected array value for set mutation on args.",
			);
			return Promise.all(
				(value as Array<tg.Template.Arg>).map((a) => tg.template(a)),
			);
		}
		throw new Error(`Unexpected mutation kind for args: ${args.inner.kind}`);
	}
	return Promise.all(args.map((a) => tg.template(a)));
};

/** Check if a template is empty (no components or only empty strings). */
const isEmptyTemplate = (template: tg.Template): boolean => {
	if (template.components.length === 0) {
		return true;
	}
	// Check if all components are empty strings.
	return template.components.every((c) => typeof c === "string" && c === "");
};

/** Resolve a command field which may be a template arg or a mutation. */
const resolveCommandField = async (
	command: tg.Template.Arg | tg.Mutation<tg.Template.Arg> | undefined,
	existing?: tg.Template,
): Promise<tg.Template> => {
	if (command === undefined) {
		return existing ?? tg.template("");
	}
	if (command instanceof tg.Mutation) {
		if (command.inner.kind === "unset") {
			return tg.template("");
		} else if (command.inner.kind === "set") {
			return tg.template(command.inner.value);
		} else if (command.inner.kind === "set_if_unset") {
			// Treat empty template as unset for set_if_unset.
			if (existing === undefined || isEmptyTemplate(existing)) {
				return tg.template(command.inner.value);
			}
			return existing;
		} else if (command.inner.kind === "prefix" && existing !== undefined) {
			return tg.Template.join(
				command.inner.separator ?? "",
				command.inner.template,
				existing,
			);
		} else if (command.inner.kind === "suffix" && existing !== undefined) {
			return tg.Template.join(
				command.inner.separator ?? "",
				existing,
				command.inner.template,
			);
		} else if (
			command.inner.kind === "prefix" ||
			command.inner.kind === "suffix"
		) {
			return command.inner.template;
		} else {
			throw new Error(
				`Unexpected mutation kind for command: ${command.inner.kind}`,
			);
		}
	}
	// If the command is already a template and it's empty, preserve existing.
	// This handles the case where an args-only override was pre-merged and created
	// a CommandBody with an empty command placeholder.
	if (
		command instanceof tg.Template &&
		isEmptyTemplate(command) &&
		existing !== undefined
	) {
		return existing;
	}
	return tg.template(command);
};

/** Resolve a body arg to a ScriptBody or CommandBody. */
const resolveBodyArg = async (
	arg: tg.Template.Arg | CommandBodyArg,
): Promise<ScriptBody | CommandBody> => {
	if (isCommandBodyArg(arg)) {
		return resolveCommandBodyArg(arg);
	} else {
		return tg.template(arg);
	}
};

/** Resolve a command body arg to a CommandBody. */
const resolveCommandBodyArg = async (
	arg: CommandBodyArg,
): Promise<CommandBody> => {
	const command = await resolveCommandField(arg.command);
	const args = await resolveArgsField(arg.args);
	return { command, args };
};

/** Construct a template from a resolved phase. */
export const constructPhaseTemplate = async (
	phase: Phase,
): Promise<tg.Template> => {
	const { body, pre, post } = phase;
	let pre_ = tg``;
	if (pre !== undefined) {
		const preTemplate = await constructBodyTemplate(pre);
		if (preTemplate.components.length > 0) {
			pre_ = tg`${preTemplate}\n`;
		}
	}
	let post_ = tg``;
	if (post !== undefined) {
		const postTemplate = await constructBodyTemplate(post);
		if (postTemplate.components.length > 0) {
			post_ = tg.Template.raw`\n${postTemplate}`;
		}
	}
	return tg`${pre_}${await constructBodyTemplate(body)}${post_}`;
};

/** Construct a template from a resolved body (script or command). */
export const constructBodyTemplate = async (
	body: ScriptBody | CommandBody,
): Promise<tg.Template> => {
	if (isScriptBody(body)) {
		return body;
	} else {
		const { command, args } = body;
		const args_ =
			args && args.length > 0
				? tg.Template.raw` ${tg.Template.join(" ", ...args)}`
				: tg``;
		return tg`${command}${args_}`;
	}
};

export const maybeMutationToTemplate = async (
	arg: tg.MaybeMutation,
): Promise<tg.Template> => {
	if (arg === undefined) {
		return tg.template();
	} else if (arg instanceof tg.Mutation) {
		if (arg.inner.kind === "unset") {
			return tg.template();
		} else if (arg.inner.kind === "set" || arg.inner.kind === "set_if_unset") {
			tg.assert(
				arg.inner.value instanceof tg.Template ||
					tg.Artifact.is(arg.inner.value) ||
					typeof arg.inner.value === "string",
			);
			return tg.template(arg.inner.value);
		} else if (arg.inner.kind === "prefix" || arg.inner.kind === "suffix") {
			return tg.template(arg.inner.template);
		} else {
			throw new Error("Cannot produce a template from an array mutation.");
		}
	} else {
		// If it is a Manifest template, get the value.
		if (typeof arg === "object" && "kind" in arg && arg.kind === "unset") {
			return tg.template();
		}
		const templateArg =
			typeof arg === "object" && "value" in arg ? arg.value : arg;
		if (
			templateArg instanceof tg.Template ||
			tg.Artifact.is(templateArg) ||
			typeof templateArg === "string"
		) {
			return tg.template(templateArg);
		} else {
			throw new Error("Cannot produce a template from arg.");
		}
	}
};

export const test = async () => {
	await Promise.all([
		basic(),
		order(),
		override(),
		testPrefixSuffix(),
		testSetIfUnset(),
		testScriptToCommand(),
		testPrePostHooks(),
		testMultipleArgs(),
		testArrayInput(),
		testCommandMutations(),
	]);
	return true;
};

export const basic = async () => {
	const prepare = tg`echo "preparing" >> ${tg.output}`;
	const configure = tg`echo "configuring" >> ${tg.output}`;
	const build_ = tg`echo "building" >> ${tg.output}`;
	const check = tg`echo "checking" >> ${tg.output}`;
	const install = tg`echo "installing" >> ${tg.output}`;
	const fixup = tg`echo "fixing up" >> ${tg.output}`;

	const phases = {
		prepare,
		configure,
		build: build_,
		check,
		install,
		fixup,
	};

	const arg = {
		phases,
	};

	const output = await run(arg, { bootstrap: true }).then(tg.File.expect);
	const text = await output.text();
	const expected =
		"preparing\nconfiguring\nbuilding\nchecking\ninstalling\nfixing up\n";
	tg.assert(text === expected);
	return true;
};

export const order = async () => {
	const prepare = tg`echo "preparing" >> ${tg.output}`;
	const configure = tg`echo "configuring" >> ${tg.output}`;
	const build_ = tg`echo "building" >> ${tg.output}`;
	const check = tg`echo "checking" >> ${tg.output}`;
	const install = tg`echo "installing" >> ${tg.output}`;
	const fixup = tg`echo "fixing up" >> ${tg.output}`;
	const order = ["fixup", "prepare", "install", "build", "configure"];

	const phases = {
		prepare,
		configure,
		build: build_,
		check,
		install,
		fixup,
	};

	const arg = {
		phases,
		order,
	};

	const output = await run(arg, { bootstrap: true }).then(tg.File.expect);
	const text = await output.text();
	const expected = "fixing up\npreparing\ninstalling\nbuilding\nconfiguring\n";
	tg.assert(text === expected);
	return true;
};

export const override = async () => {
	const prepare = `echo "preparing"`;
	const configure = {
		command: `echo "configuring"`,
		args: ["--default-arg"],
	};
	const build_ = {
		command: `echo "building"`,
		args: ["--default-arg"],
	};
	const check = `echo "checking"`;
	const install = `echo "installing"`;
	const fixup = `echo "fixing up"`;

	const defaultPhases = {
		prepare,
		configure,
		build: build_,
		check,
		install,
		fixup,
	};

	// Should add args, leaving the default command.
	const configureOverride = {
		args: ["--arg1", "--arg2"],
	};

	// Should remove the args on build and replace the command.
	const buildOverride: std.phases.CommandArg = {
		command: `echo "building override"`,
		args: tg.Mutation.unset(),
	};

	const overrides: std.phases.PhasesArg = {
		configure: configureOverride,
		build: buildOverride,
		check: tg.Mutation.unset(),
	};

	// Merge the phases using arg() to get the resolved Phases directly.
	const resolved = await arg(defaultPhases, overrides);

	// Assert configure phase: command unchanged, args appended.
	const configurePhase = resolved.configure;
	tg.assert(configurePhase !== undefined, "configure phase should exist");
	tg.assert(
		isCommandBody(configurePhase.body),
		"configure body should be a command",
	);
	const configureBody = configurePhase.body as CommandBody;
	tg.assert(
		configureBody.args !== undefined && configureBody.args.length === 3,
		`configure should have 3 args (default + override), got ${configureBody.args?.length}`,
	);

	// Assert build phase: command replaced, args removed.
	const buildPhase = resolved.build;
	tg.assert(buildPhase !== undefined, "build phase should exist");
	tg.assert(isCommandBody(buildPhase.body), "build body should be a command");
	const buildBody = buildPhase.body as CommandBody;
	tg.assert(
		buildBody.args === undefined,
		`build args should be undefined (unset), got ${buildBody.args}`,
	);
	// Verify the command was replaced by checking it contains "override".
	const buildCommandText = buildBody.command.components
		.filter((c): c is string => typeof c === "string")
		.join("");
	tg.assert(
		buildCommandText.includes("override"),
		`build command should contain 'override', got: ${buildCommandText}`,
	);

	// Assert check phase: deleted by Mutation.unset().
	tg.assert(
		resolved.check === undefined,
		"check phase should be undefined (unset by Mutation.unset())",
	);

	// Assert prepare, install, fixup phases: unchanged.
	tg.assert(resolved.prepare !== undefined, "prepare phase should exist");
	tg.assert(resolved.install !== undefined, "install phase should exist");
	tg.assert(resolved.fixup !== undefined, "fixup phase should exist");

	// Also verify the full run still works using the merged phases.
	await run({ phases: resolved, bootstrap: true });
	return true;
};

/** Test prefix and suffix mutations on phase bodies. */
export const testPrefixSuffix = async () => {
	const basePhases = {
		build: tg`echo "building"`,
	};

	// Test prefix mutation.
	const withPrefix = await arg(basePhases, {
		build: tg.Mutation.prefix(tg`echo "before" && `, ""),
	});
	tg.assert(withPrefix.build !== undefined, "build phase should exist");
	tg.assert(isScriptBody(withPrefix.build.body), "body should be a script");
	const prefixText = (withPrefix.build.body as tg.Template).components
		.filter((c): c is string => typeof c === "string")
		.join("");
	tg.assert(
		prefixText.includes("before") && prefixText.includes("building"),
		`prefix should prepend content, got: ${prefixText}`,
	);

	// Test suffix mutation.
	const withSuffix = await arg(basePhases, {
		build: tg.Mutation.suffix(tg` && echo "after"`, ""),
	});
	tg.assert(withSuffix.build !== undefined, "build phase should exist");
	tg.assert(isScriptBody(withSuffix.build.body), "body should be a script");
	const suffixText = (withSuffix.build.body as tg.Template).components
		.filter((c): c is string => typeof c === "string")
		.join("");
	tg.assert(
		suffixText.includes("building") && suffixText.includes("after"),
		`suffix should append content, got: ${suffixText}`,
	);

	// Test prefix on command body (converts to script).
	const commandPhases = {
		build: { command: "make", args: ["-j4"] },
	};
	const commandWithPrefix = await arg(commandPhases, {
		build: tg.Mutation.prefix(tg`cd src && `, ""),
	});
	tg.assert(
		commandWithPrefix.build !== undefined,
		"build phase should exist after prefix",
	);
	tg.assert(
		isScriptBody(commandWithPrefix.build.body),
		"command with prefix should become script",
	);

	return true;
};

/** Test set_if_unset mutation. */
export const testSetIfUnset = async () => {
	// When phase exists, set_if_unset should not override.
	const existing = { build: tg`echo "existing"` };
	const withSetIfUnset = await arg(existing, {
		build: await tg.Mutation.setIfUnset(tg`echo "fallback"`),
	});
	tg.assert(
		withSetIfUnset.build !== undefined,
		"build phase should exist after set_if_unset",
	);
	const existingText = (withSetIfUnset.build.body as tg.Template).components
		.filter((c): c is string => typeof c === "string")
		.join("");
	tg.assert(
		existingText.includes("existing"),
		`set_if_unset should not override existing, got: ${existingText}`,
	);

	// When phase does not exist, set_if_unset should set it.
	const empty: PhasesArg = {};
	const withFallback = await arg(empty, {
		build: tg.Mutation.setIfUnset(tg`echo "fallback"`),
	});
	tg.assert(withFallback.build !== undefined, "build phase should be set");
	const fallbackText = (withFallback.build.body as tg.Template).components
		.filter((c): c is string => typeof c === "string")
		.join("");
	tg.assert(
		fallbackText.includes("fallback"),
		`set_if_unset should set when empty, got: ${fallbackText}`,
	);

	return true;
};

/** Test script body converting to command when args-only override is applied. */
export const testScriptToCommand = async () => {
	// Script body + args-only override = command body with script as command.
	const scriptPhases = {
		configure: tg`./configure`,
	};
	const withArgs = await arg(scriptPhases, {
		configure: { args: ["--prefix=/usr", "--enable-shared"] },
	});

	tg.assert(withArgs.configure !== undefined, "configure phase should exist");
	tg.assert(
		isCommandBody(withArgs.configure.body),
		"script + args should become command body",
	);
	const body = withArgs.configure.body as CommandBody;
	tg.assert(
		body.args !== undefined && body.args.length === 2,
		`should have 2 args, got ${body.args?.length}`,
	);

	return true;
};

/** Test pre and post hooks on phases. */
export const testPrePostHooks = async () => {
	const phasesWithHooks = {
		build: {
			pre: tg`echo "pre-build" >> ${tg.output}`,
			body: tg`echo "building" >> ${tg.output}`,
			post: tg`echo "post-build" >> ${tg.output}`,
		},
	};

	const resolved = await arg(phasesWithHooks);
	tg.assert(resolved.build !== undefined, "build phase should exist");
	tg.assert(resolved.build.pre !== undefined, "pre hook should exist");
	tg.assert(resolved.build.post !== undefined, "post hook should exist");

	// Run and verify output order.
	const output = await run({
		phases: resolved,
		order: ["build"],
		bootstrap: true,
	}).then(tg.File.expect);
	const text = await output.text();
	tg.assert(
		text.includes("pre-build") &&
			text.includes("building") &&
			text.includes("post-build"),
		`output should contain all three parts, got: ${text}`,
	);
	// Verify order: pre comes before body, body comes before post.
	const preIdx = text.indexOf("pre-build");
	const bodyIdx = text.indexOf("building");
	const postIdx = text.indexOf("post-build");
	tg.assert(
		preIdx < bodyIdx && bodyIdx < postIdx,
		`hooks should execute in order: pre(${preIdx}) < body(${bodyIdx}) < post(${postIdx})`,
	);

	return true;
};

/** Test merging multiple phase args. */
export const testMultipleArgs = async () => {
	const base = {
		configure: { command: "./configure", args: ["--base"] },
	};
	const override1 = {
		configure: { args: ["--opt1"] },
	};
	const override2 = {
		configure: { args: ["--opt2"] },
	};
	const override3 = {
		build: tg`make`,
	};

	// Merge all at once.
	const merged = await arg(base, override1, override2, override3);

	// Configure should have all args appended.
	tg.assert(merged.configure !== undefined, "configure should exist");
	const configBody = merged.configure.body as CommandBody;
	tg.assert(
		configBody.args !== undefined && configBody.args.length === 3,
		`configure should have 3 args, got ${configBody.args?.length}`,
	);

	// Build should exist from override3.
	tg.assert(merged.build !== undefined, "build should exist");

	return true;
};

/** Test array input to arg(). */
export const testArrayInput = async () => {
	const phases1 = { configure: tg`./configure` };
	const phases2 = { build: tg`make` };
	const phases3 = { install: tg`make install` };

	// Pass array of phases.
	const merged = await arg([phases1, phases2], phases3);

	tg.assert(merged.configure !== undefined, "configure should exist");
	tg.assert(merged.build !== undefined, "build should exist");
	tg.assert(merged.install !== undefined, "install should exist");

	return true;
};

/** Test mutations on command field within command body. */
export const testCommandMutations = async () => {
	const base = {
		build: { command: "make", args: ["-j4"] },
	};

	// Test command prefix mutation.
	const withPrefix = await arg(base, {
		build: { command: tg.Mutation.prefix("nice ", "") },
	});
	tg.assert(withPrefix.build !== undefined, "build should exist after prefix");
	const prefixBody = withPrefix.build.body as CommandBody;
	const prefixText = prefixBody.command.components
		.filter((c): c is string => typeof c === "string")
		.join("");
	tg.assert(
		prefixText.includes("nice") && prefixText.includes("make"),
		`command prefix should work, got: ${prefixText}`,
	);

	// Test command suffix mutation.
	const withSuffix = await arg(base, {
		build: { command: tg.Mutation.suffix(" all", "") },
	});
	tg.assert(withSuffix.build !== undefined, "build should exist after suffix");
	const suffixBody = withSuffix.build.body as CommandBody;
	const suffixText = suffixBody.command.components
		.filter((c): c is string => typeof c === "string")
		.join("");
	tg.assert(
		suffixText.includes("make") && suffixText.includes("all"),
		`command suffix should work, got: ${suffixText}`,
	);

	// Test set_if_unset on command field.
	const noCommand = {
		build: { args: ["-j4"] },
	};
	const withSetIfUnset = await arg(noCommand, {
		build: { command: tg.Mutation.setIfUnset("make") },
	});
	tg.assert(
		withSetIfUnset.build !== undefined,
		"build should exist after set_if_unset",
	);
	const setBody = withSetIfUnset.build.body as CommandBody;
	const setText = setBody.command.components
		.filter((c): c is string => typeof c === "string")
		.join("");
	tg.assert(
		setText.includes("make"),
		`set_if_unset should set command, got: ${setText}`,
	);

	return true;
};
