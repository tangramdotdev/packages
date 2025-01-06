import * as std from "std" with { path: "../../std" };
import * as cmake from "cmake" with { path: "../../cmake" };

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export const build = tg.target(async (arg: Arg) => {
	const { build, env: envArg, host, source } = arg ?? {};

	const env_ = envArg ?? std.env.arg(env({ build, host }), envArg);
	const arg_ = { build, env: env_, host, source };

	return cmake.build(arg_);
});

export default build;

type EnvArg = {
	build?: string | undefined;
	host?: string | undefined;
};

export const env = tg.target(async (arg: EnvArg) => {
	const { build: build_, host: host_ } = arg ?? {};
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;
	return std.env(
		cmake.cmake({ ...std.triple.rotate({ build, host }) }),
		cmake.ninja.default_({ ...std.triple.rotate({ build, host }) }),
	);
});
