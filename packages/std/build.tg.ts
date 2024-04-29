import * as std from "./tangram.tg.ts";

/** Run an executable and return the artifact written to `tg.output`. */
export async function build(
	...args: tg.Args<build.Arg>
): Promise<tg.Artifact | undefined> {
	type Apply = {
		targetArg: Array<tg.Target.Arg>;
	};
	let { targetArg: targetArgs_ } = await tg.Args.apply<build.Arg, Apply>(
		args,
		async (arg) => {
			if (
				typeof arg === "string" ||
				tg.Template.is(arg) ||
				tg.File.is(arg) ||
				tg.Symlink.is(arg)
			) {
				return {};
			} else {
				let object: tg.MaybeMutationMap<Apply> = {};
				if (arg.targetArg) {
					object.targetArg = tg.Mutation.is(arg.targetArg)
						? arg.targetArg
						: await tg.Mutation.arrayAppend<tg.Target.Arg>(arg.targetArg);
				}
				return object;
			}
		},
	);

	// Create the executable.
	let executable = await std.wrap(...args);

	// Check if the user specified an explicit host.
	let targetArgs = targetArgs_ ?? [];
	let specifiedHost =
		targetArgs.filter(
			(arg) =>
				arg !== undefined &&
				typeof arg === "object" &&
				"host" in arg &&
				arg.host !== undefined,
		).length > 0;

	// If not, determine an approriate host from the executable.
	if (!specifiedHost) {
		let detectedHost = await std.triple.host();
		let executableTriples = await std.file.executableTriples(executable);
		let hostSystem = executableTriples?.includes(detectedHost)
			? detectedHost
			: executableTriples?.at(0);
		let host = std.triple.archAndOs(hostSystem ?? detectedHost);
		targetArgs.push({ host });
	}

	// Run.
	return tg.Artifact.expect(
		await tg.build(
			{
				executable,
			},
			...targetArgs,
		),
	);
}

export namespace build {
	export type Arg = string | tg.Template | tg.File | tg.Symlink | ArgObject;

	export type ArgObject = std.wrap.ArgObject & {
		/** Options to configure the target being built. */
		targetArg?: tg.Target.Arg;
	};
}
