import * as std from "std" with { local: "../../std" };
import cmake from "cmake" with { local: "../../cmake" };
import openssl from "openssl" with { local: "../../openssl.tg.ts" };
import * as rust from "rust" with { local: "../../rust" };

export const metadata = {
	name: "autobuild-rust",
	version: "0.0.0",
	tag: "autobuild-rust/0.0.0",
};

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export const cargo = async (arg: tg.Unresolved<Arg>) => {
	const resolved = await tg.resolve(arg);
	const { env: envArg, ...rest } = resolved;

	const env_ =
		envArg ??
		std.env.arg(env({ build: resolved.build, host: resolved.host }), envArg);
	const arg_ = { ...rest, env: env_ };

	return await rust.cargo.build(arg_);
};

export default cargo;

export const plain = async (arg: tg.Unresolved<Arg>) => {
	const resolved = await tg.resolve(arg);
	const { env: envArg, ...rest } = resolved;

	const env_ = envArg ?? env({ build: resolved.build, host: resolved.host });
	const arg_ = { ...rest, env: env_ };

	return await rust.build.build(arg_);
};

type EnvArg = {
	build?: string | undefined;
	host?: string | undefined;
};

export const env = async (arg?: tg.Unresolved<EnvArg>) => {
	const { build: build_, host: host_ } = arg ? await tg.resolve(arg) : {};
	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;
	return std.env(
		rust.self({ ...std.triple.rotate({ build, host }) }),
		cmake({ ...std.triple.rotate({ build, host }) }),
		openssl({ build, host }),
	);
};
