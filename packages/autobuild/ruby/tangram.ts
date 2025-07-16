import * as std from "std" with { local: "../../std" };
import * as ruby from "ruby" with { local: "../../ruby" };
import { wrapScripts } from "../common";

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export const plain = async (arg: tg.Unresolved<Arg>) => {
	const resolved = await tg.resolve(arg);
	const { env: envArg, source } = resolved;

	const env_ =
		envArg ??
		(await std.env.arg(
			env({ build: resolved.build, host: resolved.host }),
			envArg,
		));
	const toolchain = await ruby.self();
	const interpreter = await toolchain.get("bin/ruby").then(tg.File.expect);
	return wrapScripts({
		directory: source,
		extension: ".rb",
		interpreter,
		env: env_,
	});
};

export default plain;

type EnvArg = {
	build?: string | undefined;
	host?: string | undefined;
};

export const env = async (arg: tg.Unresolved<EnvArg>) => {
	const { build: build_, host: host_ } = arg ? await tg.resolve(arg) : {};
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;
	return std.env(ruby.self({ ...std.triple.rotate({ build, host }) }));
};
