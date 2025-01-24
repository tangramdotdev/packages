import * as std from "std" with { path: "../../std" };
import cmake from "cmake" with { path: "../../cmake" };
import openssl from "openssl" with { path: "../../openssl" };
import * as rust from "rust" with { path: "../../rust" };

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export const cargo = tg.target(async (arg: Arg) => {
	const { env: envArg, ...rest } = arg ?? {};

	const env_ =
		envArg ?? std.env.arg(env({ build: arg.build, host: arg.host }), envArg);
	const arg_ = { ...rest, env: env_ };

	return await rust.cargo.build(arg_);
});

export default cargo;

export const plain = tg.target(async (arg: Arg) => {
	const { env: envArg, ...rest } = arg ?? {};

	const env_ = envArg ?? env({ build: arg.build, host: arg.host });
	const arg_ = { ...rest, env: env_ };

	return await rust.build.build(arg_);
});

type EnvArg = {
	build?: string | undefined;
	host?: string | undefined;
};

export const env = tg.target(async (arg?: EnvArg) => {
	const { build: build_, host: host_ } = arg ?? {};
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;
	return std.env(
		rust.self({ ...std.triple.rotate({ build, host }) }),
		cmake({ ...std.triple.rotate({ build, host }) }),
		openssl({ build, host }),
	);
});
