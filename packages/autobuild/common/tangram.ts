import * as std from "std" with { local: "../../std" };

export type WrapScriptsArg = std.wrap.ArgObject & {
	directory: tg.Directory;
	extension: string;
	env?: std.env.Arg;
};

/** Wrap all the scripts with a given extension to use the given interpreter */
export const wrapScripts = async (
	arg: tg.Unresolved<WrapScriptsArg>,
): Promise<tg.Directory> => {
	const resolved = await tg.resolve(arg);
	const { directory, env, extension, ...wrapArg } = resolved;
	let ret = resolved.directory;
	for await (const [name, artifact] of resolved.directory) {
		if (name.endsWith(extension) && artifact instanceof tg.File) {
			ret = await tg.directory(ret, {
				[`${name}`]: std.wrap(artifact, wrapArg, { env }),
			});
		}
	}
	return ret;
};
