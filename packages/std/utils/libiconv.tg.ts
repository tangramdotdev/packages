import * as std from "../tangram.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

export const metadata = {
	name: "libiconv",
	version: "1.17",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:8f74213b56238c85a50a5329f77e06198771e70dd9a739779f4c02f65d971313";
	return std.download.fromGnu({ name, version, checksum });
});

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
	usePrerequisites?: boolean;
};

export const build = tg.target(async (arg?: Arg) => {
	const {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
		usePrerequisites = true,
	} = arg ?? {};

	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const configure = {
		args: ["--disable-dependency-tracking"],
	};

	const env: tg.Unresolved<std.Args<std.env.Arg>> = [env_];
	if (usePrerequisites) {
		env.push(prerequisites(build));
	}

	const output = buildUtil({
		...(await std.triple.rotate({ build, host })),
		env: std.env.arg(env),
		phases: { configure },
		sdk,
		source: source_ ?? source(),
	});

	return output;
});

export default build;

import * as bootstrap from "../bootstrap.tg.ts";
export const test = tg.target(async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const sdk = await bootstrap.sdk(host);
	return build({ host, sdk: false, env: sdk });
});
