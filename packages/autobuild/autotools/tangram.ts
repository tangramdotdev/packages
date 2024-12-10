import * as std from "std" with { path: "../../std" };
import { $ } from "std" with { path: "../../std" };

import * as autoconf from "autoconf" with { path: "../../autoconf" };
import * as automake from "automake" with { path: "../../automake" };
import * as gettext from "gettext" with { path: "../../gettext" };
import * as help2man from "help2man" with { path: "../../help2man" };
import * as perl from "perl" with { path: "../../perl" };
import * as texinfo from "texinfo" with { path: "../../texinfo" };

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export const default_ = tg.target(async (arg: Arg) => {
	// TODO - compbine env with the imported tools.
	return std.autotools.build(arg);
});

export default default_;
