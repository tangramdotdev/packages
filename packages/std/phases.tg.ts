import * as std from "./tangram.ts";

/** Helper for constructing multi-phase build targets. */

export type Arg = ArgObject | PhasesArg | undefined;

export type ArgObject = {
	bootstrap?: boolean;
	debug?: boolean;
	env?: std.env.Arg;
	order?: Array<string>;
	phases?: PhasesArg;
	processName?: string;
	checksum?: tg.Checksum | undefined;
	network?: boolean;
	command?: tg.Command.Arg.Object;
};

export type Object = {
	bootstrap?: boolean;
	debug?: boolean;
	env?: std.env.Arg;
	order?: Array<string>;
	phases: Phases;
	processName?: string;
	checksum?: tg.Checksum | undefined;
	network?: boolean;
	command?: tg.Command.Arg.Object;
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

export const run = async (...args: std.Args<Arg>) => {
	const {
		bootstrap = false,
		checksum,
		network = false,
		debug,
		env: env_,
		order: order_,
		phases = {},
		processName,
		command: commandArg,
	} = await arg(...args);

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

export const arg = async (...args: std.Args<Arg>): Promise<Object> => {
	const argObject = await std.args.apply<Arg, ArgObject>({
		args,
		map: async (arg) => {
			if (arg === undefined) {
				return {};
			} else if (isArgObject(arg)) {
				const ret: ArgObject = {};
				if ("bootstrap" in arg) {
					ret.bootstrap = arg.bootstrap;
				}
				if ("debug" in arg) {
					ret.debug = arg.debug;
				}
				if ("env" in arg) {
					ret.env = arg.env;
				}
				if ("order" in arg) {
					ret.order = arg.order;
				}
				if ("phases" in arg) {
					ret.phases = arg.phases;
				}
				if ("processName" in arg) {
					ret.processName = arg.processName;
				}
				if ("checksum" in arg) {
					ret.checksum = arg.checksum;
				}
				if ("network" in arg) {
					ret.network = arg.network;
				}
				if ("command" in arg) {
					ret.command = arg.command;
				}
				return ret;
			} else {
				return { phases: arg } as ArgObject;
			}
		},
		reduce: {
			command: "merge",
			env: (a, b) => std.env.arg(a, b, { utils: false }),
			phases: (a, b) => mergePhases(a, b),
		},
	});
	tg.assert(argObject.phases !== undefined, "expected phases to be defined");
	return argObject as Object;
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

export const isArgObject = (arg: unknown): arg is ArgObject => {
	return (
		arg !== undefined &&
		typeof arg === "object" &&
		arg !== null &&
		("bootstrap" in arg ||
			"checksum" in arg ||
			"command" in arg ||
			"debug" in arg ||
			"env" in arg ||
			"network" in arg ||
			"order" in arg ||
			"phases" in arg ||
			"processName" in arg ||
			"target" in arg)
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

export const mergePhases = async (
	...args: Array<tg.Unresolved<Arg | Phases | Array<Arg>>>
): Promise<Phases> => {
	const phases: Phases = {};

	// Process a single arg, merging its phases into the accumulated result.
	const processArg = async (arg: Arg | Phases | undefined) => {
		if (arg === undefined) {
			return;
		}
		// Extract phases from ArgObject if present, otherwise use directly.
		const phasesArg = isArgObject(arg) ? arg.phases : arg;
		if (phasesArg === undefined) {
			return;
		}
		for (const [key, value] of Object.entries(phasesArg)) {
			const existing = phases[key];
			const mergedPhase = await mergePhaseArgs(existing, value);
			if (mergedPhase !== undefined) {
				phases[key] = mergedPhase;
			} else {
				// Phase was unset - delete the key.
				delete phases[key];
			}
		}
	};

	for (const unresolvedArg of args) {
		const arg = await tg.resolve(unresolvedArg);
		// Handle arrays by processing each element in order.
		if (Array.isArray(arg)) {
			for (const element of arg) {
				await processArg(element);
			}
		} else {
			await processArg(arg);
		}
	}
	return phases;
};

/** Internal type for phase arg processing. */
type PhaseArgIntermediate = {
	body?: BodyArg;
	pre?: BodyArg;
	post?: BodyArg;
};

/** Merge phase args into a resolved Phase. */
export const mergePhaseArgs = async (
	...args: Array<tg.Unresolved<PhaseArg>>
): Promise<Phase | undefined> => {
	const resolved = await Promise.all(args.map(tg.resolve));

	// Convert each arg to a PhaseArgIntermediate for uniform handling.
	const objectArgs: Array<PhaseArgIntermediate | "unset"> = await Promise.all(
		resolved.map(async (arg) => {
			if (arg === undefined) {
				return {};
			} else if (arg instanceof tg.Mutation) {
				if (arg.inner.kind === "unset") {
					return "unset";
				} else if (
					arg.inner.kind === "set" ||
					arg.inner.kind === "set_if_unset"
				) {
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
				} else if (arg.inner.kind === "prefix" || arg.inner.kind === "suffix") {
					// prefix/suffix mutations apply to the body.
					return { body: arg as tg.Mutation<tg.Template.Arg> };
				} else {
					throw new Error(
						`Unexpected mutation kind for phase: ${arg.inner.kind}`,
					);
				}
			} else if (isPhaseArgObject(arg)) {
				return arg;
			} else if (isBodyArg(arg)) {
				return { body: arg };
			} else {
				throw new Error(`Unexpected phase arg type: ${arg}`);
			}
		}),
	);

	// Check if any arg is "unset" - if so, the phase is removed.
	if (objectArgs.some((arg) => arg === "unset")) {
		return undefined;
	}

	// Merge the phase arg objects.
	let body: ScriptBody | CommandBody | undefined;
	let pre: ScriptBody | CommandBody | undefined;
	let post: ScriptBody | CommandBody | undefined;

	for (const obj of objectArgs) {
		if (obj === "unset") continue;
		if (obj.body !== undefined) {
			body = await mergeBodyArgs(body, obj.body);
		}
		if (obj.pre !== undefined) {
			pre = await mergeBodyArgs(pre, obj.pre);
		}
		if (obj.post !== undefined) {
			post = await mergeBodyArgs(post, obj.post);
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
			// Replace entirely.
			const value = arg.inner.value;
			return resolveBodyArg(value);
		} else if (arg.inner.kind === "set_if_unset") {
			if (existing !== undefined) {
				return existing;
			}
			return resolveBodyArg(arg.inner.value);
		} else if (arg.inner.kind === "prefix") {
			// Prefix applies to script bodies.
			const template = arg.inner.template;
			const separator = arg.inner.separator ?? "";
			if (existing === undefined) {
				return template;
			} else if (isScriptBody(existing)) {
				return tg.Template.join(separator, template, existing);
			} else {
				// Convert command to script, then prefix.
				const script = await constructBodyTemplate(existing);
				return tg.Template.join(separator, template, script);
			}
		} else if (arg.inner.kind === "suffix") {
			// Suffix applies to script bodies.
			const template = arg.inner.template;
			const separator = arg.inner.separator ?? "";
			if (existing === undefined) {
				return template;
			} else if (isScriptBody(existing)) {
				return tg.Template.join(separator, existing, template);
			} else {
				// Convert command to script, then suffix.
				const script = await constructBodyTemplate(existing);
				return tg.Template.join(separator, script, template);
			}
		} else {
			throw new Error(`Unexpected mutation kind for body: ${arg.inner.kind}`);
		}
	}

	// Handle script body arg (template-like).
	if (isScriptBodyArg(arg)) {
		// Script replaces any existing body.
		return tg.template(arg);
	}

	// Handle command body arg.
	if (isCommandBodyArg(arg)) {
		if (existing === undefined) {
			// No existing body, create new command body.
			return resolveCommandBodyArg(arg);
		} else if (isScriptBody(existing)) {
			// Script + command args: if only args provided, this is likely an error.
			// If command provided, replace with command body.
			if (arg.command !== undefined) {
				return resolveCommandBodyArg(arg);
			} else {
				// Only args provided to a script body - convert to command body with args.
				// Use the existing script as the command.
				const resolvedArgs = await resolveArgsField(arg.args);
				return { command: existing, args: resolvedArgs };
			}
		} else {
			// Command + command: merge.
			const result: CommandBody = { command: existing.command };
			if (existing.args !== undefined) {
				result.args = [...existing.args];
			}

			// Command: resolve with existing for mutation support.
			if (arg.command !== undefined) {
				result.command = await resolveCommandField(
					arg.command,
					existing.command,
				);
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
					const newArgs = await Promise.all(
						arg.args.map((a) => tg.template(a)),
					);
					result.args = result.args ? [...result.args, ...newArgs] : newArgs;
				}
			}

			return result;
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
			return existing ?? tg.template(command.inner.value);
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
	await Promise.all([basic(), order(), override()]);
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

	// Merge the phases using arg() to get the resolved phases object.
	const resolved = await arg(defaultPhases, overrides, { bootstrap: true });

	// Assert configure phase: command unchanged, args appended.
	const configurePhase = resolved.phases.configure;
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
	const buildPhase = resolved.phases.build;
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
		resolved.phases.check === undefined,
		"check phase should be undefined (unset by Mutation.unset())",
	);

	// Assert prepare, install, fixup phases: unchanged.
	tg.assert(
		resolved.phases.prepare !== undefined,
		"prepare phase should exist",
	);
	tg.assert(
		resolved.phases.install !== undefined,
		"install phase should exist",
	);
	tg.assert(resolved.phases.fixup !== undefined, "fixup phase should exist");

	// Also verify the full run still works.
	await run(defaultPhases, overrides, { bootstrap: true });
	return true;
};
