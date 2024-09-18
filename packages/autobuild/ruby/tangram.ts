import * as std from "std" with { path: "../../std" };
import * as ruby from "ruby" with { path: "../../ruby" };
import { wrapScripts } from "../common";

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export const gem = tg.target(async (arg: Arg) => {
	return tg.unimplemented();
});

export default gem;

export const plain = tg.target(async (arg: Arg) => {
	const { source } = arg ?? {};
	const toolchain = await ruby.toolchain();
	const interpreter = await toolchain.get("bin/ruby").then(tg.File.expect);
	return wrapScripts({ directory: source, extension: ".rb", interpreter });
});

type EnvArg = {
	build?: string | undefined;
	host?: string | undefined;
};

export const env = tg.target(async (arg: EnvArg) => {
	return tg.unimplemented();
});
