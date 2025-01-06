import * as std from "std" with { path: "../../std" };
import * as go from "go" with { path: "../../go" };

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export const build = tg.target(async (arg: Arg) => {
	const { build, env: envArg, host, source } = arg ?? {};

	const env_ = envArg ?? env({ build, host });
	const arg_ = { build, env: env_, host, source };
	return go.build(arg_);
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
	return std.env(go.toolchain({ ...std.triple.rotate({ build, host }) }));
});
