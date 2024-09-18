import * as std from "std" with { path: "../../std" };

export type WrapScriptsArg = std.wrap.ArgObject & {
	directory: tg.Directory;
	extension: string;
};

/** Wrap all the scripts with a given extension to use the given interpreter */
export const wrapScripts = async (
	arg: WrapScriptsArg,
): Promise<tg.Directory> => {
	const { directory, extension, ...wrapArg } = arg;
	let ret = arg.directory;
	for await (const [name, artifact] of arg.directory) {
		if (name.endsWith(extension) && artifact instanceof tg.File) {
			ret = await tg.directory(ret, {
				[`${name}`]: std.wrap(artifact, wrapArg),
			});
		}
	}
	return ret;
};
