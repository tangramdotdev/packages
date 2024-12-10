import * as std from "std" with { path: "../../std" };
import * as cmake from "cmake" with { path: "../../cmake" };

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export const default_ = tg.target(async (arg: Arg) => {
	return cmake.build(arg);
});

export default default_;
