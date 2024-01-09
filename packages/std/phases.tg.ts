import * as std from "./tangram.tg.ts";

/** Helper for constructing multi-phase build targets. */

export type Arg = ArgObject | PhasesArg;

export type ArgObject = {
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
	command?: tg.MaybeMutation<tg.Template | tg.Artifact | string>;
	args?: tg.MaybeNestedArray<
		tg.MaybeMutation<tg.Template | tg.Artifact | string>
	>;
};

export let target = async (...args: tg.Args<Arg>) => {
	type Apply = {
		env: std.env.Arg;
		targetArgs: Array<tg.Target.Arg>;
		order?: Array<string>;
		phases: Array<PhasesArg>;
	};

	let {
		env: env_,
		order: order_,
		phases: phases_,
		targetArgs,
	} = await tg.Args.apply<Arg, Apply>(args, async (arg) => {
		if (arg === undefined) {
			return {};
		} else if (isArgObject(arg)) {
			let object: tg.MutationMap<Apply> = {};
			if (arg.target !== undefined) {
				object.targetArgs = tg.Mutation.is(arg.target)
					? arg.target
					: await tg.Mutation.arrayAppend<tg.Target.Arg>(arg.target);
			}
			if (arg.env !== undefined) {
				if (tg.Mutation.is(arg.env)) {
					object.env = arg.env;
				} else {
					object.env = await tg.Mutation.arrayAppend<std.env.Arg>(arg.env);
				}
			}
			if (arg.order !== undefined) {
				object.order = arg.order;
			}
			if (arg.phases !== undefined) {
				if (tg.Mutation.is(arg.phases)) {
					object.phases = arg.phases;
				} else {
					object.phases = await tg.Mutation.arrayAppend(arg.phases);
				}
			}
			return object;
		} else if (typeof arg === "object") {
			return { phases: await tg.Mutation.arrayAppend(arg) };
		} else {
			return tg.unreachable();
		}
	});

	// Merge the phases into a single object.
	let phases = await (phases_ ?? []).reduce(
		async (acc, el) => {
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
	// let empty = tg``;
	// FIXME: On Linux, some configure scripts fail using stdin redirection, "bad file descriptor".  As a workaround, we redirect stdin from /dev/null first to force the file descriptor to be valid.  I don't know why this is happenening now, it is likely related to Linux sandboxing.
	let empty = tg`exec 0</dev/null`;
	let order = order_ ?? defaultOrder();
	let script = empty;
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
				return tg`${ret}\n${phaseTemplate}`;
			}
		}, empty);
	} else {
		script = empty;
	}

	// Produce an env object for use with tg.target().
	let env = await std.env.object(env_);

	// Find the shell to use, if set.
	let maybeShellExe = await std.env.tryGetShellExecutable(env);

	// Produce a target arg with the env and optionally the shell executable.
	let arg;
	if (maybeShellExe === undefined) {
		arg = { env };
	} else {
		arg = { executable: maybeShellExe, args: ["-eu"], env };
	}

	// Build the script, passing all target args through.
	return tg.target(script, arg, ...(targetArgs ?? []));
};

export let build = async (...args: tg.Args<Arg>) => {
	return (await target(...args)).build();
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
			tg.Template.is(arg) ||
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

export let mergeCommandArgs = async (
	...args: tg.Args<CommandArg>
): Promise<Command> => {
	type Apply = {
		command: tg.Template;
		args: Array<tg.Template>;
	};
	let { command: command_, args: args_ } = await tg.Args.apply<
		CommandArg,
		Apply
	>(args, async (arg) => {
		if (arg === undefined) {
			return {};
		} else if (
			tg.Template.is(arg) ||
			tg.Artifact.is(arg) ||
			typeof arg === "string"
		) {
			return { command: await tg.template(arg) };
		} else if (tg.Mutation.is(arg)) {
			// Make sure the mutation is valid.
			if (arg.inner.kind === "unset") {
				return {
					command: tg.Mutation.unset(),
					args: tg.Mutation.unset(),
				};
			} else if (arg.inner.kind === "set") {
				if (
					typeof arg.inner.value === "string" ||
					tg.Template.is(arg.inner.value) ||
					tg.Artifact.is(arg.inner.value)
				) {
					return { command: arg };
				} else if (isCommandArgObject(arg.inner.value)) {
					let command = tg.Mutation.is(arg.inner.value.command)
						? arg.inner.value.command
						: await tg.template(arg.inner.value.command);
					let args = undefined;
					if (arg.inner.value.args !== undefined) {
						args = tg.Mutation.is(arg.inner.value.args)
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
					tg.Template.is(arg.inner.value) ||
					tg.Artifact.is(arg.inner.value)
				) {
					return { command: arg };
				} else if (isCommandArgObject(arg.inner.value)) {
					let command = tg.Mutation.is(arg.inner.value.command)
						? arg.inner.value.command
						: await tg.Mutation.setIfUnset(
								await tg.template(arg.inner.value.command),
						  );
					let args = undefined;
					if (arg.inner.value.args !== undefined) {
						args = tg.Mutation.is(arg.inner.value.args)
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
			} else if (
				arg.inner.kind === "template_append" ||
				arg.inner.kind === "template_prepend"
			) {
				return { command: arg };
			} else if (
				arg.inner.kind === "array_append" ||
				arg.inner.kind === "array_prepend"
			) {
				throw new Error("Cannot apply array mutation to a command.");
			} else {
				throw new Error("Unexpected mutation for command.");
			}
		} else if (isCommandArgObject(arg)) {
			let ret: tg.MutationMap<Apply> = {};
			// Handle command, default mutation is `set`.
			if (arg.command !== undefined) {
				ret.command = tg.Mutation.is(arg.command)
					? arg.command
					: await tg.template(arg.command);
			}
			// Handle args, detault mutation is `array_append`.
			if (arg.args !== undefined) {
				ret.args = tg.Mutation.is(arg.args)
					? arg.args
					: await tg.mutation({
							kind: "array_append",
							values: await Promise.all(
								std.flatten(arg.args ?? []).map(maybeMutationToTemplate),
							),
					  });
			}
			return ret;
		} else {
			return tg.unreachable();
		}
	});

	return {
		command: command_ ?? (await tg.template()),
		args: args_ ?? [],
	};
};

export let mergePhaseArgs = async (
	...args: tg.Args<PhaseArg>
): Promise<Phase | undefined> => {
	type Apply = {
		body?: tg.MaybeNestedArray<CommandArg>;
		pre?: tg.MaybeNestedArray<CommandArg>;
		post?: tg.MaybeNestedArray<CommandArg>;
	};
	let {
		body: body_,
		pre: pre_,
		post: post_,
	} = await tg.Args.apply<PhaseArg, Apply>(args, async (arg) => {
		if (arg === undefined) {
			return {};
		} else if (isPhaseArgObject(arg)) {
			let ret: tg.MutationMap<Apply> = {
				body: arg.body
					? await tg.Mutation.arrayAppend<CommandArg>(arg.body)
					: "",
			};
			if (arg.pre !== undefined) {
				ret.pre = await tg.Mutation.arrayAppend<CommandArg>(arg.pre);
			}
			if (arg.post !== undefined) {
				ret.post = await tg.Mutation.arrayAppend<CommandArg>(arg.post);
			}
			return ret;
		} else if (tg.Mutation.is(arg)) {
			if (arg.inner.kind === "unset") {
				return { body: arg };
			} else if (
				arg.inner.kind === "set" ||
				arg.inner.kind === "set_if_unset"
			) {
				tg.assert(isPhaseArg(arg.inner.value));
				return (
					(await mergePhaseArgs(...std.flatten(arg.inner.value ?? []))) ?? {}
				);
			} else {
				throw new Error("Unexpected mutation for phase.");
			}
		} else if (
			typeof arg === "string" ||
			tg.Template.is(arg) ||
			tg.Artifact.is(arg) ||
			isCommandArgObject(arg)
		) {
			return {
				body: await tg.Mutation.arrayAppend<CommandArg>(arg),
			};
		} else {
			throw new Error("Unexpected phase arg type.");
		}
	});

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
	return isCommandArgObject(arg) && tg.Template.is(arg.command);
};

export let maybeMutationToTemplate = async (
	arg: tg.MaybeMutation,
): Promise<tg.Template> => {
	if (arg === undefined) {
		return tg.template();
	} else if (tg.Mutation.is(arg)) {
		if (arg.inner.kind === "unset") {
			return tg.template();
		} else if (arg.inner.kind === "set" || arg.inner.kind === "set_if_unset") {
			tg.assert(
				tg.Template.is(arg.inner.value) ||
					tg.Artifact.is(arg.inner.value) ||
					typeof arg.inner.value === "string",
			);
			return tg.template(arg.inner.value);
		} else if (
			arg.inner.kind === "template_prepend" ||
			arg.inner.kind === "template_append"
		) {
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
			tg.Template.is(templateArg) ||
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
	let a = {
		HELLO: tg.mutation({
			kind: "template_prepend",
			template: "hello",
			separator: " ",
		}),
		GOODBYE: [
			tg.mutation({
				kind: "template_prepend",
				template: "name",
				separator: " ",
			}),
			tg.mutation({
				kind: "template_prepend",
				template: "goodbye",
				separator: " ",
			}),
		],
	};
	let b = {
		HELLO: [
			tg.mutation({
				kind: "template_append",
				template: "world!!",
				separator: " ",
			}),
			tg.mutation({
				kind: "template_append",
				template: "mars",
				separator: ",",
			}),
		],
		GOODBYE: tg.Mutation.unset(),
	};

	return build(
		{ phases: { build: "env > $OUTPUT" } },
		{ target: { env: a } },
		{ target: { env: b } },
	);
});
