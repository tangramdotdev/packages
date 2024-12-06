import * as std from "std" with { path: "../../std" };
import { $ } from "std" with { path: "../../std" };
import * as go from "go" with { path: "../../go" };

// FIXME - this file seems unnecessary

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export const default_ = tg.target(async (arg: Arg) => {
	return go.build(arg);
});

export default default_;
