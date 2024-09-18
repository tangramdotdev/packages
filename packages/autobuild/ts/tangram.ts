import * as std from "std" with { path: "../../std" };
import * as bun from "bun" with { path: "../../bun" };
import { wrapScripts } from "../common";

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export const build = tg.target(async (arg: Arg) => {
	return tg.unimplemented();
});

export default build;

export const plain = tg.target(async (arg: Arg) => {
	const { source } = arg;
	const toolchain = await bun.toolchain();
	const interpreter = await toolchain.get("bin/bun").then(tg.File.expect);
	return wrapScripts({ directory: source, extension: ".t", interpreter }); // FIXME - move this into std? or a common utils module?
});

type EnvArg = {
	build?: string | undefined;
	host?: string | undefined;
};

export const env = tg.target(async (arg?: EnvArg) => {
	return tg.unimplemented();
});
