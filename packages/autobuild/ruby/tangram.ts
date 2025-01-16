import * as std from "std" with { path: "../../std" };
import * as ruby from "ruby" with { path: "../../ruby" };
import { wrapScripts } from "../common";

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export const plain = tg.target(async (arg: Arg) => {
	const { env: envArg, source } = arg ?? {};

	const env_ =
		envArg ??
		(await std.env.arg(env({ build: arg.build, host: arg.host }), envArg));
	const toolchain = await ruby.toolchain();
	const interpreter = await toolchain.get("bin/ruby").then(tg.File.expect);
	return wrapScripts({
		directory: source,
		extension: ".rb",
		interpreter,
		env: env_,
	});
});

export default plain;

type EnvArg = {
	build?: string | undefined;
	host?: string | undefined;
};

export const env = tg.target(async (arg: EnvArg) => {
	const { build: build_, host: host_ } = arg ?? {};
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;
	return std.env(ruby.toolchain({ ...std.triple.rotate({ build, host }) }));
});
