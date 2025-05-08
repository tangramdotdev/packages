import * as std from "std" with { path: "../../std" };
import * as cmake from "cmake" with { path: "../../cmake" };

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export const build = async (arg: tg.Unresolved<Arg>) => {
	const resolved = await tg.resolve(arg);
	const env_ = std.env.arg(
		env({ build: resolved.build, host: resolved.host }),
		resolved.env,
	);
	const arg_ = { ...resolved, env: env_ };
	return cmake.build(arg_);
};

export default build;

type EnvArg = {
	build?: string | undefined;
	host?: string | undefined;
};

export const env = async (arg: tg.Unresolved<EnvArg>) => {
	const resolved = await tg.resolve(arg);
	const { build: build_, host: host_ } = resolved;
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;
	return std.env(
		cmake.self({ ...std.triple.rotate({ build, host }) }),
		cmake.ninja.build({ ...std.triple.rotate({ build, host }) }),
	);
};
