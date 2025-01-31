import * as std from "../tangram.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

export const metadata = {
	name: "libiconv",
	version: "1.18",
};

export const source = tg.command(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:3b08f5f4f9b4eb82f151a7040bfd6fe6c6fb922efe4b1659c66ea933276965e8";
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

export const build = tg.command(async (arg?: Arg) => {
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
export const test = tg.command(async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const sdk = await bootstrap.sdk(host);
	return build({ host, sdk: false, env: sdk });
});
