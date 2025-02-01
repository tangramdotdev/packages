import * as std from "std" with { path: "../../std" };
import * as go from "go" with { path: "../../go" };

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export const build = tg.command(async (arg: Arg) => {
	const { env: envArg, ...rest } = arg ?? {};

	const env_ = envArg ?? env({ build: arg.build, host: arg.host });
	const arg_ = { ...rest, env: env_ };
	return go.build(arg_);
});

export default build;

type EnvArg = {
	build?: string | undefined;
	host?: string | undefined;
};

export const env = tg.command(async (arg: EnvArg) => {
	const { build: build_, host: host_ } = arg ?? {};
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;
	return std.env(go.self({ ...std.triple.rotate({ build, host }) }));
});
