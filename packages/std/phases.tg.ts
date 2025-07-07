import * as std from "./tangram.ts";

/** Helper for constructing multi-phase build targets. */

export type Arg = ArgObject | PhasesArg | undefined;

export type ArgObject = {
	bootstrap?: boolean;
	debug?: boolean;
	env?: std.env.Arg;
	order?: Array<string>;
	phases?: PhasesArg;
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
	checksum?: tg.Checksum | undefined;
	network?: boolean;
	command?: tg.Command.Arg.Object;
};

export type Phases = {
	[key: string]: Phase;
};

export type PhasesArg =
	| {
			[key: string]: PhaseArg;
	  }
	| undefined;

export type PhaseArg = CommandArg | tg.MaybeMutationMap<PhaseArgObject>;

export type Phase = {
	body: Command;
	pre?: Command;
	post?: Command;
};

export type PhaseArgObject = {
	body?: CommandArg;
	pre?: CommandArg;
	post?: CommandArg;
};

export type CommandArg =
	| undefined
	| tg.MaybeMutation<tg.Template.Arg>
	| tg.MaybeMutationMap<CommandArgObject>;

export type Command = {
	command: tg.Template;
	args?: Array<tg.Template>;
};

export type CommandArgObject = {
	command?: tg.Template.Arg;
	args?: Array<tg.Template.Arg>;
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
		export LOGDIR=$OUTPUT/.tangram_logs
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

const isPhaseArg = (arg: unknown): arg is PhaseArg => {
	return (
		arg !== null &&
		(arg === undefined ||
			typeof arg === "string" ||
			arg instanceof tg.Template ||
			tg.Artifact.is(arg) ||
			isPhaseObject(arg) ||
			isCommandArgObject(arg) ||
			isPhaseArgObject(arg))
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
			"target" in arg)
	);
};

export const isPhaseArgObject = (arg: unknown): arg is PhaseArgObject => {
	return (
		arg !== undefined &&
		typeof arg === "object" &&
		arg !== null &&
		("body" in arg || "pre" in arg || "post" in arg)
	);
};

export const isPhaseObject = (arg: unknown): arg is Phase => {
	return (
		arg !== undefined &&
		typeof arg === "object" &&
		arg !== null &&
		"body" in arg &&
		isCommand(arg.body)
	);
};

export const mergePhases = async (
	...args: Array<PhasesArg>
): Promise<Phases> => {
	const phases: Phases = {};
	for (const phasesArg of args) {
		if (phasesArg === undefined) {
			continue;
		}
		for (const [key, value] of Object.entries(phasesArg)) {
			const mergedPhase = await mergePhaseArgs(phases[key], value);
			if (mergedPhase !== undefined) {
				phases[key] = mergedPhase;
			}
		}
	}
	return phases;
};

export const mergePhaseArgs = async (
	...args: Array<tg.Unresolved<PhaseArg>>
): Promise<Phase | undefined> => {
	const resolved = await Promise.all(args.map(tg.resolve));
	const objectArgs: Array<PhaseArgObject> = await Promise.all(
		resolved.map(async (arg) => {
			if (arg === undefined) {
				return {};
			} else if (isPhaseArgObject(arg)) {
				return {
					body: arg.body,
					pre: arg.pre,
					post: arg.post,
				};
			} else if (arg instanceof tg.Mutation) {
				if (arg.inner.kind === "unset") {
					return { body: arg };
				} else if (
					arg.inner.kind === "set" ||
					arg.inner.kind === "set_if_unset"
				) {
					tg.assert(isPhaseArg(arg.inner.value));
					const phaseArg = arg.inner.value;
					if (phaseArg === undefined) {
						return {};
					} else if (phaseArg instanceof tg.Mutation) {
						return { body: phaseArg };
					} else if (isPhaseArgObject(phaseArg)) {
						return {
							body: phaseArg.body,
							pre: phaseArg.pre,
							post: phaseArg.post,
						};
					} else if (isCommandArgObject(phaseArg)) {
						return { body: phaseArg };
					} else {
						throw new Error(`Unexpected arg for phase: ${arg}`);
					}
				} else {
					throw new Error(`Unexpected mutation for phase: ${arg}`);
				}
			} else if (
				typeof arg === "string" ||
				tg.Artifact.is(arg) ||
				arg instanceof tg.Template ||
				isCommandArgObject(arg)
			) {
				return { body: arg };
			} else {
				throw new Error(`Unexpected phase arg type: ${arg}`);
			}
		}),
	);
	const phaseArgObject: PhaseArgObject = {};
	for (const object of objectArgs) {
		if (object.body !== undefined) {
			phaseArgObject.body = await mergeCommandArgs(
				phaseArgObject.body,
				object.body,
			);
		}
		if (object.pre !== undefined) {
			phaseArgObject.pre = await mergeCommandArgs(
				phaseArgObject.pre,
				object.pre,
			);
		}
		if (object.post !== undefined) {
			phaseArgObject.post = await mergeCommandArgs(
				phaseArgObject.post,
				object.post,
			);
		}
	}

	if (!phaseArgObject.body) {
		return undefined;
	}
	return phaseArgObject as Phase;
};

export const mergeCommandArgs = async (
	...args: Array<tg.Unresolved<CommandArg>>
): Promise<CommandArg> => {
	const resolved = await Promise.all(args.map(tg.resolve));
	const objectArgs: Array<tg.MaybeMutationMap<CommandArgObject>> =
		await Promise.all(
			resolved.map(async (arg) => {
				if (arg === undefined) {
					return {};
				} else if (
					arg instanceof tg.Template ||
					tg.Artifact.is(arg) ||
					typeof arg === "string"
				) {
					return { command: await tg.template(arg) };
				} else if (arg instanceof tg.Mutation) {
					if (arg.inner.kind === "unset") {
						return {
							command: tg.Mutation.unset(),
							args: tg.Mutation.unset(),
						};
					} else if (
						arg.inner.kind === "set" ||
						arg.inner.kind === "set_if_unset" ||
						arg.inner.kind === "prefix" ||
						arg.inner.kind === "suffix"
					) {
						return { command: arg };
					} else {
						throw new Error("unexpected mutation: ${arg}");
					}
				} else if (isCommandArgObject(arg)) {
					return arg;
				} else {
					return tg.unreachable(`unexpected arg: ${arg}`);
				}
			}),
		);
	const commandObject: CommandArgObject = {};
	for (const object of objectArgs) {
		if ("command" in object && object.command !== undefined) {
			const commandMutation =
				object.command instanceof tg.Mutation
					? object.command
					: await tg.Mutation.set<tg.Template.Arg>(object.command);
			await commandMutation.apply(commandObject, "command");
		}
		if ("args" in object && object.args !== undefined) {
			const argsMutation =
				object.args instanceof tg.Mutation
					? object.args
					: await tg.Mutation.append<Array<tg.Template.Arg>>(object.args);
			await argsMutation.apply(commandObject, "args");
		}
	}

	if (commandObject.command !== undefined) {
		commandObject.command = await tg.template(commandObject.command);
	}
	if (commandObject.args !== undefined) {
		commandObject.args = await Promise.all(
			commandObject.args.map(async (arg) => await tg.template(arg)),
		);
	}
	return commandObject;
};

export const constructPhaseTemplate = async (
	phase: Phase,
): Promise<tg.Template> => {
	const { body, pre, post } = phase;
	let pre_ = tg``;
	const preTemplate = await constructCommandTemplate(pre);
	if (preTemplate && preTemplate.components.length > 0) {
		pre_ = tg`${preTemplate}\n`;
	}
	let post_ = tg``;
	const postTemplate = await constructCommandTemplate(post);
	if (postTemplate && postTemplate.components.length > 0) {
		post_ = tg.Template.raw`\n${postTemplate}`;
	}
	return tg`${pre_}${constructCommandTemplate(body)}${post_}`;
};

export const isCommandArgObject = (arg: unknown): arg is CommandArgObject => {
	return (
		arg != null &&
		typeof arg === "object" &&
		("command" in arg || "args" in arg)
	);
};

export const isCommand = (arg: unknown): arg is Command => {
	return isCommandArgObject(arg) && arg.command instanceof tg.Template;
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
			throw new Error("Cannot produce a template from an array mutation");
		}
	} else {
		// If its a Manifest template, get the value.
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
			throw new Error("Cannot produce a template from arg");
		}
	}
};

export const constructCommandTemplate = (
	arg?: Command,
): Promise<tg.Template> => {
	if (arg === undefined) {
		return tg``;
	} else {
		const { command, args } = arg;
		const args_ =
			args && args.length > 0
				? tg.Template.raw` ${tg.Template.join(" ", ...args)}`
				: tg``;
		return tg`${command}${args_}`;
	}
};

export const test = async () => {
	await Promise.all([basic(), order(), override()]);
	return true;
};

export const basic = async () => {
	const prepare = `echo "preparing" >> $OUTPUT`;
	const configure = `echo "configuring" >> $OUTPUT`;
	const build_ = `echo "building" >> $OUTPUT`;
	const check = `echo "checking" >> $OUTPUT`;
	const install = `echo "installing" >> $OUTPUT`;
	const fixup = `echo "fixing up" >> $OUTPUT`;

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
	const prepare = `echo "preparing" >> $OUTPUT`;
	const configure = `echo "configuring" >> $OUTPUT`;
	const build_ = `echo "building" >> $OUTPUT`;
	const check = `echo "checking" >> $OUTPUT`;
	const install = `echo "installing" >> $OUTPUT`;
	const fixup = `echo "fixing up" >> $OUTPUT`;
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

	// Should remove the args on build and replace the command
	const buildOverride: std.phases.CommandArg = {
		command: `echo "building override"`,
		args: tg.Mutation.unset(),
	};

	const overrides: std.phases.PhasesArg = {
		configure: configureOverride,
		build: buildOverride,
		check: tg.Mutation.unset(),
	};

	await run(defaultPhases, overrides, { bootstrap: true });
	return true;
};
