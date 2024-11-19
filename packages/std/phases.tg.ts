import * as std from "./tangram.ts";

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

export type CommandArgObject = {
	command?: tg.MaybeMutation<tg.Template | tg.Artifact | string> | undefined;
	args?:
		| tg.MaybeNestedArray<tg.MaybeMutation<tg.Template | tg.Artifact | string>>
		| undefined;
};

export const target = tg.target(async (...args: std.Args<Arg>) => {
	const objectArgs = await Promise.all(
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
	const mutationArgs = await std.args.createMutations<
		ArgObject,
		std.args.MakeArrayKeys<ArgObject, "env" | "phases" | "target">
	>(objectArgs, {
		debug: "set",
		env: "append",
		order: "set",
		phases: "append",
		target: "append",
	});
	const {
		debug,
		env: env_,
		order: order_,
		phases: phases_,
		target: targetArgs,
	} = await std.args.applyMutations(mutationArgs);

	// Merge the phases into a single object.
	const phases = await (phases_ ?? []).reduce(
		async (acc, el) => {
			if (el === undefined) {
				return acc;
			}
			const ret = await acc;
			for (const [key, value] of Object.entries(el)) {
				const phase = await mergePhaseArgs(ret[key], value);
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

	// Find the shell to use, if set.
	const maybeShellExe = await std.env.tryGetShellExecutable(env_);

	// Produce an env object for use with tg.target().
	const env = await std.env.arg(env_);

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

export const build = async (...args: std.args.UnresolvedArgs<Arg>) => {
	return await target(...args).then((t) => t.output());
};

export type Phases = {
	[key: string]: Phase;
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
		("env" in arg || "order" in arg || "phases" in arg || "target" in arg)
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

export const mergePhaseArgs = async (
	...args: std.args.UnresolvedArgs<PhaseArg>
): Promise<Phase | undefined> => {
	const objectArgs = await Promise.all(
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
					const phaseArg = arg.inner.value;
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
	const mutationArgs = await std.args.createMutations<
		PhaseArgObject,
		std.args.MakeArrayKeys<PhaseArgObject, "body" | "pre" | "post">
	>(objectArgs, {
		body: "append",
		pre: "append",
		post: "append",
	});
	const {
		body: body_,
		pre: pre_,
		post: post_,
	} = await std.args.applyMutations(mutationArgs);

	if (!body_) {
		return undefined;
	}

	// Construct output object.
	const body = await mergeCommandArgs(body_);
	const ret: Phase = { body };
	if (pre_) {
		ret.pre = await mergeCommandArgs(pre_);
	}
	if (post_) {
		ret.post = await mergeCommandArgs(post_);
	}
	return ret;
};

export const mergeCommandArgs = async (
	...args: std.args.UnresolvedArgs<CommandArg>
): Promise<Command> => {
	const objectArgs: Array<CommandArgObject> = await Promise.all(
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
						const command =
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
						const command =
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
				const object: CommandArgObject = {};
				if ("command" in arg) {
					const command =
						arg.command instanceof tg.Mutation
							? arg.command
							: await tg.template(arg.command);
					object["command"] = command;
				}
				if ("args" in arg) {
					const args =
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
	const mutationArgs = await std.args.createMutations<
		CommandArgObject,
		Command
	>(objectArgs, {
		command: "set",
		args: "append",
	});
	const { command, args: args_ } = await std.args.applyMutations(mutationArgs);

	if (args_ === undefined) {
		return { command };
	} else {
		return { command, args: args_ };
	}
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
		post_ = tg`\n${postTemplate}`;
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
			args && args.length > 0 ? tg` ${tg.Template.join(" ", ...args)}` : tg``;
		return tg`${command}${args_}`;
	}
};

export const test = tg.target(async () => {
	await Promise.all([basic(), order(), override(), mutateEnv()]);
	return true;
});

export const basic = tg.target(async () => {
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

	const output = await build(arg).then(tg.File.expect);
	const text = await output.text();
	const expected =
		"preparing\nconfiguring\nbuilding\nchecking\ninstalling\nfixing up\n";
	tg.assert(text === expected);
	return true;
});

export const order = tg.target(async () => {
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

	const output = await build(arg).then(tg.File.expect);
	const text = await output.text();
	const expected = "fixing up\npreparing\ninstalling\nbuilding\nconfiguring\n";
	tg.assert(text === expected);
	return true;
});

export const override = tg.target(async () => {
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

	const arg1 = {
		phases: defaultPhases,
	};

	// Should add args, leaving the default command.
	const configureOverride = {
		args: ["--arg1", "--arg2"],
	};

	// Should remove the args on build and replace the command
	const buildOverride = {
		command: `echo "building override"`,
		args: tg.Mutation.unset(),
	};

	const overrides = {
		configure: configureOverride,
		build: buildOverride,
		check: tg.Mutation.unset(),
	};

	const arg2 = {
		phases: overrides,
	};

	return build(arg1, arg2);
});

export const mutateEnv = tg.target(async () => {
	const a = await std.env.arg({
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
	const b = await std.env.arg({
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
