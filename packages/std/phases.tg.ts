import * as std from "./tangram.tg.ts";

/** Helper for constructing multi-phase build targets. */

export type Arg = ArgObject | PhasesArg;

export type ArgObject = {
	debug?: boolean;
	env?: std.env.Arg;
	order?: Array<string>;
	phases?: PhasesArg;
	target?: tg.Target.Arg;
};

export type PhasesArg = {
	[key: string]: tg.MaybeNestedArray<PhaseArg>;
};

export type PhaseArg = tg.MaybeMutation<CommandArg | PhaseArgObject>;

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

type CommandArg = tg.MaybeMutation<
	undefined | string | tg.Artifact | tg.Template | CommandArgObject
>;

export type Command = {
	command: tg.Template;
	args?: Array<tg.Template>;
};

type CommandArgObject = {
	command?: tg.MaybeMutation<tg.Template | tg.Artifact | string> | undefined;
	args?:
		| tg.MaybeNestedArray<tg.MaybeMutation<tg.Template | tg.Artifact | string>>
		| undefined;
};

export let target = tg.target(async (...args: std.Args<Arg>) => {
	let objectArgs = await Promise.all(
		args.map((arg) => {
			if (arg === undefined) {
				return {};
			} else if (isArgObject(arg)) {
				return arg;
			} else {
				return { phases: arg } as ArgObject;
			}
		}),
	);
	let mutationArgs = await std.args.createMutations<
		ArgObject,
		std.args.MakeArrayKeys<ArgObject, "env" | "phases" | "target">
	>(objectArgs, {
		debug: "set",
		env: "append",
		order: "set",
		phases: "append",
		target: "append",
	});
	let {
		debug,
		env: env_,
		order: order_,
		phases: phases_,
		target: targetArgs,
	} = await std.args.applyMutations(mutationArgs);

	// Merge the phases into a single object.
	let phases = await (phases_ ?? []).reduce(
		async (acc, el) => {
			if (el === undefined) {
				return acc;
			}
			let ret = await acc;
			for (let [key, value] of Object.entries(el)) {
				let phase = await mergePhaseArgs(ret[key], value);
				if (phase === undefined) {
					delete ret[key];
				} else {
					ret[key] = phase;
				}
			}
			return ret;
		},
		Promise.resolve({} as Phases),
	);

	// Construct the phases in order.
	let empty = tg.template();
	let order = order_ ?? defaultOrder();
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
		script = tg`${empty}
		set -eu
		`;
	}
	if (phases !== undefined) {
		script = order.reduce(async (ret, phaseName) => {
			let phase = phases[phaseName];
			if (phase === undefined) {
				return ret;
			}
			let phaseTemplate = await constructPhaseTemplate(phase);
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

	// Find the shell to use, if set.
	let maybeShellExe = await std.env.tryGetShellExecutable(env_);

	// Produce an env object for use with tg.target().
	let env = await std.env.arg(env_);

	// Produce a target arg with the env and optionally the shell executable.
	if (maybeShellExe === undefined) {
		return tg.target(script, { env }, ...(targetArgs ?? []));
	} else {
		return tg.target(
			{
				executable: maybeShellExe,
				args: ["-euc", script],
				env,
			},
			...(targetArgs ?? []),
		);
	}
});

export let build = async (...args: std.args.UnresolvedArgs<Arg>) => {
	return await target(...args).then((t) => t.output());
};

export type Phases = {
	[key: string]: Phase;
};

export let defaultOrder = () => [
	"prepare",
	"configure",
	"build",
	"check",
	"install",
	"fixup",
];

let isPhaseArg = (arg: unknown): arg is PhaseArg => {
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

export let isArgObject = (arg: unknown): arg is ArgObject => {
	return (
		arg !== undefined &&
		typeof arg === "object" &&
		arg !== null &&
		("env" in arg || "order" in arg || "phases" in arg || "target" in arg)
	);
};

export let isPhaseArgObject = (arg: unknown): arg is PhaseArgObject => {
	return (
		arg !== undefined &&
		typeof arg === "object" &&
		arg !== null &&
		("body" in arg || "pre" in arg || "post" in arg)
	);
};

export let isPhaseObject = (arg: unknown): arg is Phase => {
	return (
		arg !== undefined &&
		typeof arg === "object" &&
		arg !== null &&
		"body" in arg &&
		isCommand(arg.body)
	);
};

export let mergePhaseArgs = async (
	...args: std.args.UnresolvedArgs<PhaseArg>
): Promise<Phase | undefined> => {
	let objectArgs = await Promise.all(
		std.flatten(await Promise.all(args.map(tg.resolve))).map(async (arg) => {
			if (arg === undefined) {
				return {};
			} else if (isPhaseArgObject(arg)) {
				return arg;
			} else if (arg instanceof tg.Mutation) {
				if (arg.inner.kind === "unset") {
					return { body: arg };
				} else if (
					arg.inner.kind === "set" ||
					arg.inner.kind === "set_if_unset"
				) {
					tg.assert(isPhaseArg(arg.inner.value));
					let phaseArg = arg.inner.value;
					if (phaseArg instanceof tg.Mutation) {
						return { body: phaseArg };
					} else if (isPhaseArgObject(phaseArg)) {
						return phaseArg;
					} else if (isCommandArgObject(phaseArg)) {
						return { body: phaseArg };
					} else {
						return { body: await tg.template(phaseArg) };
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
	let mutationArgs = await std.args.createMutations<
		PhaseArgObject,
		std.args.MakeArrayKeys<PhaseArgObject, "body" | "pre" | "post">
	>(objectArgs, {
		body: "append",
		pre: "append",
		post: "append",
	});
	let {
		body: body_,
		pre: pre_,
		post: post_,
	} = await std.args.applyMutations(mutationArgs);

	if (!body_) {
		return undefined;
	}

	// Construct output object.
	let body = await mergeCommandArgs(body_);
	let ret: Phase = { body };
	if (pre_) {
		ret.pre = await mergeCommandArgs(pre_);
	}
	if (post_) {
		ret.post = await mergeCommandArgs(post_);
	}
	return ret;
};

export let mergeCommandArgs = async (
	...args: std.args.UnresolvedArgs<CommandArg>
): Promise<Command> => {
	let objectArgs: Array<CommandArgObject> = await Promise.all(
		std.flatten(await Promise.all(args.map(tg.resolve))).map(async (arg) => {
			if (arg === undefined) {
				return {};
			} else if (
				arg instanceof tg.Template ||
				tg.Artifact.is(arg) ||
				typeof arg === "string"
			) {
				return { command: await tg.template(arg) };
			} else if (arg instanceof tg.Mutation) {
				// Make sure the mutation is valid.
				if (arg.inner.kind === "unset") {
					return {
						command: tg.Mutation.unset(),
						args: tg.Mutation.unset(),
					};
				} else if (arg.inner.kind === "set") {
					if (
						typeof arg.inner.value === "string" ||
						arg.inner.value instanceof tg.Template ||
						tg.Artifact.is(arg.inner.value)
					) {
						return { command: arg };
					} else if (isCommandArgObject(arg.inner.value)) {
						let command =
							arg.inner.value.command instanceof tg.Mutation
								? arg.inner.value.command
								: await tg.template(arg.inner.value.command);
						let args = undefined;
						if (arg.inner.value.args !== undefined) {
							args =
								arg.inner.value.args instanceof tg.Mutation
									? arg.inner.value.args
									: await Promise.all(
											std
												.flatten(arg.inner.value.args ?? [])
												.map(maybeMutationToTemplate),
									  );
						}
						return { command, args };
					} else {
						throw new Error(
							"Unexpected mutation. Cannot set a command to a non-command value.",
						);
					}
				} else if (arg.inner.kind === "set_if_unset") {
					if (
						typeof arg.inner.value === "string" ||
						arg.inner.value instanceof tg.Template ||
						tg.Artifact.is(arg.inner.value)
					) {
						return { command: arg };
					} else if (isCommandArgObject(arg.inner.value)) {
						let command =
							arg.inner.value.command instanceof tg.Mutation
								? arg.inner.value.command
								: await tg.Mutation.setIfUnset(
										await tg.template(arg.inner.value.command),
								  );
						let args = undefined;
						if (arg.inner.value.args !== undefined) {
							args =
								arg.inner.value.args instanceof tg.Mutation
									? arg.inner.value.args
									: await tg.Mutation.setIfUnset(
											await Promise.all(
												std
													.flatten(arg.inner.value.args ?? [])
													.map(maybeMutationToTemplate),
											),
									  );
						}
						return { command, args };
					} else {
						throw new Error(
							"Unexpected mutation. Cannot set a command to a non-command value.",
						);
					}
				} else {
					throw new Error(`Unexpected mutation for command: ${arg}`);
				}
			} else if (isCommandArgObject(arg)) {
				let object: CommandArgObject = {};
				if ("command" in arg) {
					let command =
						arg.command instanceof tg.Mutation
							? arg.command
							: await tg.template(arg.command);
					object["command"] = command;
				}
				if ("args" in arg) {
					let args =
						arg.args instanceof tg.Mutation
							? arg.args
							: await Promise.all(
									std.flatten(arg.args ?? []).map(maybeMutationToTemplate),
							  );
					object["args"] = args;
				}
				return object;
			} else {
				return tg.unreachable(`unexpected arg: ${arg}`);
			}
		}),
	);
	let mutationArgs = await std.args.createMutations<CommandArgObject, Command>(
		objectArgs,
		{
			command: "set",
			args: "append",
		},
	);
	let { command, args: args_ } = await std.args.applyMutations(mutationArgs);

	if (args_ === undefined) {
		return { command };
	} else {
		return { command, args: args_ };
	}
};

export let constructPhaseTemplate = async (
	phase: Phase,
): Promise<tg.Template> => {
	let { body, pre, post } = phase;
	let pre_ = tg``;
	let preTemplate = await constructCommandTemplate(pre);
	if (preTemplate && preTemplate.components.length > 0) {
		pre_ = tg`${preTemplate}\n`;
	}
	let post_ = tg``;
	let postTemplate = await constructCommandTemplate(post);
	if (postTemplate && postTemplate.components.length > 0) {
		post_ = tg`\n${postTemplate}`;
	}
	return tg`${pre_}${constructCommandTemplate(body)}${post_}`;
};

export let isCommandArgObject = (arg: unknown): arg is CommandArgObject => {
	return (
		arg != null &&
		typeof arg === "object" &&
		("command" in arg || "args" in arg)
	);
};

export let isCommand = (arg: unknown): arg is Command => {
	return isCommandArgObject(arg) && arg.command instanceof tg.Template;
};

export let maybeMutationToTemplate = async (
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
		let templateArg =
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

export let constructCommandTemplate = (arg?: Command): Promise<tg.Template> => {
	if (arg === undefined) {
		return tg``;
	} else {
		let { command, args } = arg;
		let args_ =
			args && args.length > 0 ? tg` ${tg.Template.join(" ", ...args)}` : tg``;
		return tg`${command}${args_}`;
	}
};

export let basicTest = tg.target(async () => {
	let prepare = `echo "preparing"`;
	let configure = `echo "configuring"`;
	let build_ = `echo "building"`;
	let check = `echo "checking"`;
	let install = `echo "installing"`;
	let fixup = `echo "fixing up"`;

	let phases = {
		prepare,
		configure,
		build: build_,
		check,
		install,
		fixup,
	};

	let arg = {
		phases,
	};

	return build(arg);
});

export let overrideTest = tg.target(async () => {
	let prepare = `echo "preparing"`;
	let configure = {
		command: `echo "configuring"`,
		args: ["--default-arg"],
	};
	let build_ = {
		command: `echo "building"`,
		args: ["--default-arg"],
	};
	let check = `echo "checking"`;
	let install = `echo "installing"`;
	let fixup = `echo "fixing up"`;

	let defaultPhases = {
		prepare,
		configure,
		build: build_,
		check,
		install,
		fixup,
	};

	let arg1 = {
		phases: defaultPhases,
	};

	// Should add args, leaving the default command.
	let configureOverride = {
		args: ["--arg1", "--arg2"],
	};

	// Should remove the args on build and replace the command
	let buildOverride = {
		command: `echo "building override"`,
		args: tg.Mutation.unset(),
	};

	let overrides = {
		configure: configureOverride,
		build: buildOverride,
		check: tg.Mutation.unset(),
	};

	let arg2 = {
		phases: overrides,
	};

	return build(arg1, arg2);
});

export let envTest = tg.target(async () => {
	let a = await std.env.arg({
		HELLO: tg.mutation({
			kind: "prefix",
			template: "hello",
			separator: " ",
		}),
		GOODBYE: [
			tg.mutation({
				kind: "prefix",
				template: "name",
				separator: " ",
			}),
			tg.mutation({
				kind: "prefix",
				template: "goodbye",
				separator: " ",
			}),
		],
	});
	let b = await std.env.arg({
		HELLO: [
			tg.mutation({
				kind: "suffix",
				template: "world!!",
				separator: " ",
			}),
			tg.mutation({
				kind: "suffix",
				template: "mars",
				separator: ",",
			}),
		],
		GOODBYE: tg.Mutation.unset(),
	});

	return build(
		{ phases: { build: "env > $OUTPUT" } },
		{ target: { env: a } },
		{ target: { env: b } },
	);
});
