import * as std from "std" with { path: "../../std" };

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export const default_ = tg.target(async (arg: Arg) => {
	return tg.unimplemented();
});

export default default_;

export const test = tg.target(async () => {
	return tg.unimplemented();
});
