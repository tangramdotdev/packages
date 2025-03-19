import * as std from "./tangram.ts";
import { createMutations, applyMutations } from "./args.tg.ts";
import * as bootstrap from "./bootstrap.tg.ts";

/** Wrapper around tg.build that attaches the default mount to commands. */
export const build = async (
	...args: std.Args<tg.Process.SpawnArg>
): Promise<tg.Value> => {
	const { command: commandArg, ...arg } = await processArg(...args);
	tg.assert(commandArg, "spawn args must include a command");
	const orig = await tg.command(commandArg);
	const mountArg = defaultMountArg(await orig.host());
	const command = await tg.command(orig, mountArg);
	return tg.build(command, arg);
};

/** Wrap a command with a default mount if the host is linux. For darwin, does not change the command. */
export const defaultMountArg = tg.command(async (
	host: string,
): Promise<tg.Command.Arg> => {
	const os = std.triple.os(host);
	if (os === "darwin") {
		return {};
	} else if (os === "linux") {
		const shellExe = bootstrap
			.shell(host)
			.then((d) => d.get("bin/sh"))
			.then(tg.File.expect);
		const envExe = bootstrap
			.env(host)
			.then((d) => d.get("bin/env"))
			.then(tg.File.expect);
		const root = tg.directory({
			[`bin/sh`]: shellExe,
			[`usr/bin/env`]: envExe
		});
		return {
			mounts: [await tg`${root}:/`],
		};
	} else {
		return tg.unreachable(`unexpected OS ${os}`);
	}
});

/** Process a set of spawn args. */
export const processArg = async (
	...args: std.Args<tg.Process.SpawnArg>
): Promise<tg.Process.SpawnArgObject> => {
	const resolved = await Promise.all(args.map(tg.resolve));
	const flattened = std.flatten(resolved);
	const objects = await Promise.all(
		flattened.map(async (arg) => {
			if (arg === undefined) {
				return {};
			} else if (
				typeof arg === "string" ||
				tg.Artifact.is(arg) ||
				arg instanceof tg.Template
			) {
				return {
					args: ["-c", arg],
					executable: "/bin/sh",
					host: await std.triple.host(),
				};
			} else if (arg instanceof tg.Command) {
				return { command: arg };
			} else {
				return arg;
			}
		}),
	);
	const mutations = await createMutations(objects, {
		args: "append",
		env: "append",
	});
	const arg = await applyMutations(mutations);
	return arg;
};
