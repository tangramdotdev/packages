import * as std from "std" with { path: "../../std" };
import * as go from "go" with { path: "../../go" };

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export const build = tg.target(async (arg: Arg) => {
	return go.build(arg);
});

export default build;

type EnvArg = {
	build?: string | undefined;
	host?: string | undefined;
};

export const env = tg.target(async (arg: EnvArg) => {
	return tg.unimplemented();
});
