import * as std from "std" with { path: "../../std" };

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export const c = tg.target(async (arg: Arg) => {
	return tg.unimplemented();
});

export const cxx = tg.target(async (arg: Arg) => {
	return tg.unimplemented();
});

export const fortran = tg.target(async (arg: Arg) => {
	return tg.unimplemented();
});

export type EnvArg = {
	build?: string | undefined;
	host?: string | undefined;
};

export const env = tg.target(async (arg: EnvArg) => {
	return tg.unimplemented();
});
