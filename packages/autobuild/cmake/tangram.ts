import * as std from "std" with { local: "../../std" };
import * as cmake from "cmake" with { local: "../../cmake" };

export const metadata = {
	name: "autobuild-cmake",
	version: "0.0.0",
	tag: "autobuild-cmake/0.0.0",
};

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export const build = async (arg: tg.Unresolved<Arg>) => {
	const resolved = await tg.resolve(arg);
	const { env: envArg, ...rest } = resolved;

	const env_ =
		envArg ??
		std.env.arg(env({ build: resolved.build, host: resolved.host }), envArg);
	const arg_ = { ...rest, env: env_ };

	return cmake.build(arg_);
};

export default build;

type EnvArg = {
	build?: string | undefined;
	host?: string | undefined;
};

export const env = async (arg: tg.Unresolved<EnvArg>) => {
	const { build: build_, host: host_ } = arg ? await tg.resolve(arg) : {};
	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;
	return std.env(
		cmake.self({ ...std.triple.rotate({ build, host }) }),
		cmake.ninja.build({ ...std.triple.rotate({ build, host }) }),
	);
};
