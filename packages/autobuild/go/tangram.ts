import * as std from "std" with { local: "../../std" };
import * as go from "go" with { local: "../../go" };

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export const build = async (arg: tg.Unresolved<Arg>) => {
	const resolved = await tg.resolve(arg);
	const { env: envArg, ...rest } = resolved;

	const env_ = envArg ?? env({ build: resolved.build, host: resolved.host });
	const arg_ = { ...rest, env: env_ };
	return go.build(arg_);
};

export default build;

type EnvArg = {
	build?: string | undefined;
	host?: string | undefined;
};

export const env = async (arg: tg.Unresolved<EnvArg>) => {
	const { build: build_, host: host_ } = arg ? await tg.resolve(arg) : {};
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;
	return std.env(go.self({ ...std.triple.rotate({ build, host }) }));
};
