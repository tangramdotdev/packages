import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

export let metadata = {
	name: "make",
	version: "4.4.1",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:dd16fb1d67bfab79a72f5e8390735c49e3e8e70b4945a15ab1f81ddb78658fb3";
	return std.download.fromGnu({ name, version, checksum });
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
		args: ["--disable-dependency-tracking"],
	};
	let phases = {
		configure,
	};

	let env = std.env.arg(env_, prerequisites(host));

	return buildUtil({
		...(await std.triple.rotate({ build, host })),
		env,
		phases,
		sdk,
		source: source_ ?? source(),
	});
});

export default build;

export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdk = await bootstrap.sdk(host);
	return build({ host, sdk: false, env: sdk });
});
