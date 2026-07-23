import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";

export const metadata = {
	name: "gawk",
	version: "5.4.1",
	tag: "gawk/5.4.1",
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:07f6f7342b7febe4313fc2c2542ad93d64fe20ad8717200109f105a826f5fd37";
	return std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});
}

export type Arg = {
	bootstrap?: boolean;
	build?: string | null;
	env?: std.env.Arg | null;
	host?: string | null;
	sdk?: std.sdk.Arg | null;
	source?: tg.Directory | null;
};

export async function build(arg?: Arg) {
	const {
		bootstrap = false,
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};

	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	const configure = {
		args: ["--disable-dependency-tracking", "--disable-rpath"],
	};

	const env = std.env.arg(env_ ?? null, prerequisites(build), {
		utils: false,
	});

	const output = autotoolsInternal({
		build,
		host,
		bootstrap,
		env,
		phases: { configure },
		processName: metadata.name,
		sdk: sdk ?? null,
		source: source_ ?? source(),
		wrapBashScriptPaths: ["bin/gawkbug"],
	});

	return output;
}

export default build;

import * as bootstrap from "../bootstrap.tg.ts";

export async function test() {
	const host = bootstrap.toolchainTriple(std.triple.host());
	const sdk = await bootstrap.sdk(host);
	return build({ host, bootstrap: true, env: sdk });
}
