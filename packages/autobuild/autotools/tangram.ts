import * as std from "std" with { path: "../../std" };
import { $ } from "std" with { path: "../../std" };

import autoconf from "autoconf" with { path: "../../autoconf" };
import automake from "automake" with { path: "../../automake" };
import gettext from "gettext" with { path: "../../gettext" };
import help2man from "help2man" with { path: "../../help2man" };
import perl from "perl" with { path: "../../perl" };
import texinfo from "texinfo" with { path: "../../texinfo" };

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export const build = tg.target(async (arg: Arg) => {
	const { build, env: envArg, host, source } = arg ?? {};

	const env_ = envArg ?? env({ build, host });
	const arg_ = { build, env: env_, host, source };
	return std.autotools.build(arg_);
});

export default build;

export type EnvArg = {
	build?: string | undefined;
	host?: string | undefined;
};

export const env = tg.target(async (arg: EnvArg) => {
	const { build: build_, host: host_ } = arg ?? {};
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;
	return std.env(
		autoconf({ build, host: build }),
		automake({ build, host: build }),
		gettext({ build, host: build }),
		help2man({ build, host: build }),
		perl({ build, host: build }),
		texinfo({ build, host: build }),
	);
});
