import * as std from "std" with { path: "../../std" };
import * as nodejs from "nodejs" with { path: "../../nodejs" };
import { wrapScripts } from "../common";

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export const node = async (arg: Arg) => {
	const { build: build_, env: envArg, host: host_, source } = arg ?? {};

	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const env_ = envArg ?? std.env.arg(env({ build, host }), envArg);
	const arg_ = { build, env: env_, host, source };
	return nodejs.build(arg_);
};

export default node;

export const plain = async (arg: Arg) => {
	// FIXME - env!
	const { source } = arg;
	const toolchain = await nodejs.self();
	const interpreter = await toolchain.get("bin/node").then(tg.File.expect);
	return wrapScripts({ directory: source, extension: ".js", interpreter });
};

type EnvArg = {
	build?: string | undefined;
	host?: string | undefined;
};

export const env = async (arg?: EnvArg) => {
	const { build: build_, host: host_ } = arg ?? {};
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;
	return std.env(nodejs.self({ ...std.triple.rotate({ build, host }) }));
};
