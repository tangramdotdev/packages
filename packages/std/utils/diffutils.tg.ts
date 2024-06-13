import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

let metadata = {
	name: "diffutils",
	version: "3.10",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:90e5e93cc724e4ebe12ede80df1634063c7a855692685919bfe60b556c9bd09e";
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
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let configure = {
		args: ["--disable-dependency-tracking", "--disable-rpath"],
	};

	let env = std.env.arg(env_, prerequisites(host));

	let output = buildUtil({
		...std.triple.rotate({ build, host }),
		env,
		sdk,
		phases: { configure },
		source: source_ ?? source(),
	});

	return output;
});

export default build;

import * as bootstrap from "../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdk = await bootstrap.sdk.arg(host);
	return build({ host, sdk });
});
