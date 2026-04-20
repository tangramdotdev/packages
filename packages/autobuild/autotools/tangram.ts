import * as std from "std" with { source: "../../std" };
import { $ } from "std" with { source: "../../std" };

import autoconf from "autoconf" with { source: "../../autoconf.tg.ts" };
import automake from "automake" with { source: "../../automake.tg.ts" };
import gettext from "gettext" with { source: "../../gettext" };
import help2man from "help2man" with { source: "../../help2man.tg.ts" };
import perl from "perl" with { source: "../../perl" };
import texinfo from "texinfo" with { source: "../../texinfo.tg.ts" };

export const metadata = {
	name: "autobuild-autotools",
	version: "0.0.0",
	tag: "autobuild-autotools/0.0.0",
};

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source: tg.Directory;
};

export const build = async (arg: tg.Unresolved<Arg>) => {
	const resolved = await tg.resolve(arg);
	const { env: envArg, ...rest } = resolved ?? {};
	const env_ = envArg ?? env({ build: resolved.build, host: resolved.host });

	let source = resolved.source;
	if (await needsReconf(source)) {
		source = await reconfigure(source);
	}

	const arg_ = { ...rest, env: env_, source };
	return std.autotools.build(arg_);
};

export default build;

export const needsReconf = async (
	sourceArg: tg.Unresolved<tg.Directory>,
): Promise<boolean> => {
	const source = await tg.resolve(sourceArg);
	const entries = await source.entries;
	const hasFile = (name: string) =>
		entries.hasOwnProperty(name) && entries[name] instanceof tg.File;
	return hasFile("configure.ac") && !hasFile("configure");
};

export const reconfigure = async (source: tg.Unresolved<tg.Directory>) => {
	return $`cp -R ${source} ${tg.output}
			chmod -R u+w ${tg.output}
			cd ${tg.output}
			autoreconf --install --verbose`
		.env(autoconf())
		.env(automake())
		.then(tg.Directory.expect);
};

export type EnvArg = {
	build?: string | undefined;
	host?: string | undefined;
};

export const env = async (arg: tg.Unresolved<EnvArg>) => {
	const { build: build_, host: host_ } = arg ? await tg.resolve(arg) : {};
	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;
	return std.env(
		autoconf({ build, host: build }),
		automake({ build, host: build }),
		gettext({ build, host: build }),
		help2man({ build, host: build }),
		perl({ build, host: build }),
		texinfo({ build, host: build }),
	);
};
