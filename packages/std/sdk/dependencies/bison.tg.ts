import * as std from "../../tangram.tg.ts";
import m4 from "./m4.tg.ts";

export let metadata = {
	name: "bison",
	version: "3.8.2",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:9bba0214ccf7f1079c5d59210045227bcf619519840ebfa80cd3849cff5a5bf2";
	return std.download.fromGnu({
		name,
		version,
		compressionFormat: "xz",
		checksum,
	});
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target((arg?: Arg) => {
	let { build, env: env_, host, sdk, source: source_ } = arg ?? {};

	let configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-nls",
			"--disable-rpath",
			"--enable-relocatable",
		],
	};

	let dependencies = [
		std.utils.env({ build, host, sdk }),
		m4({ build, host, sdk }),
	];
	let env = std.env.arg(env_, ...dependencies);

	let output = std.utils.buildUtil({
		...std.triple.rotate({ build, host }),
		env,
		phases: { configure },
		sdk,
		source: source_ ?? source(),
		wrapBashScriptPaths: ["bin/yacc"],
	});

	return output;
});

export default build;

import * as bootstrap from "../../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdkArg = await bootstrap.sdk.arg(host);
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["bison"],
		metadata,
		sdk: sdkArg,
	});
	return true;
});
