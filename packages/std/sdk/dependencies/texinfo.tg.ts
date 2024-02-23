import * as std from "../../tangram.tg.ts";
import bison from "./bison.tg.ts";
import m4 from "./m4.tg.ts";
import make from "./make.tg.ts";
import ncurses from "./ncurses.tg.ts";
import perl from "./perl.tg.ts";
import zlib from "./zlib.tg.ts";

export let metadata = {
	name: "texinfo",
	version: "7.1",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:deeec9f19f159e046fdf8ad22231981806dac332cc372f1c763504ad82b30953";
	return std.download.fromGnu({ name, version, compressionFormat, checksum });
});

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
};

export let build = tg.target((arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let dependencies = [
		bison(arg),
		m4(arg),
		make(arg),
		ncurses(arg),
		perl(arg),
		zlib(arg),
	];
	let env = [env_, std.utils.env(arg), ...dependencies];

	return std.utils.buildUtil(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			env,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

import * as bootstrap from "../../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = bootstrap.toolchainTriple(await tg.Triple.host());
	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });
	let directory = build({
		host,
		bootstrapMode,
		env: [sdk, { WATERMARK: "1" }],
	});
	await std.assert.pkg({
		directory,
		binaries: ["makeinfo", "texi2any"],
		metadata,
	});
	return directory;
});
