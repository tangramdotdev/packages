import * as std from "../../tangram.ts";

export const metadata = {
	homepage: "https://github.com/westes/flex",
	license: "https://github.com/westes/flex/tree/master?tab=License-1-ov-file",
	name: "flex",
	repository: "https://github.com/westes/flex",
	version: "2.6.4",
};

export const source = tg.command(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:e87aae032bf07c26f85ac0ed3250998c37621d95f8bd748b31f15b33c45ee995";
	const owner = "westes";
	const repo = name;
	const tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "release",
		tag,
		version,
	});
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export const build = tg.command(async (arg?: Arg) => {
	const { build, env, host, sdk, source: source_ } = arg ?? {};

	const configure = {
		args: ["--disable-dependency-tracking", "--disable-nls", "--disable-rpath"],
	};

	return std.utils.buildUtil({
		...(await std.triple.rotate({ build, host })),
		env,
		phases: { configure },
		sdk,
		source: source_ ?? source(),
	});
});

export default build;

import * as bootstrap from "../../bootstrap.tg.ts";

export const test = tg.command(async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const sdkArg = await bootstrap.sdk.arg(host);
	// FIXME
	// await std.assert.pkg({ buildFn: build, binaries: ["flex"], metadata });
	return true;
});
