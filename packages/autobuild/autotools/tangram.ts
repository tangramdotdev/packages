import * as std from "std" with { local: "../../std" };
import { $ } from "std" with { local: "../../std" };

import autoconf from "autoconf" with { local: "../../autoconf.tg.ts" };
import automake from "automake" with { local: "../../automake.tg.ts" };
import gettext from "gettext" with { local: "../../gettext.tg.ts" };
import help2man from "help2man" with { local: "../../help2man.tg.ts" };
import perl from "perl" with { local: "../../perl" };
import texinfo from "texinfo" with { local: "../../texinfo.tg.ts" };

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
