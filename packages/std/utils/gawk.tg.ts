import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";

export const metadata = {
	name: "gawk",
	version: "5.3.2",
	tag: "gawk/5.3.2",
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:f8c3486509de705192138b00ef2c00bbbdd0e84c30d5c07d23fc73a9dc4cc9cc";
	return std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});
};

export type Arg = {
	bootstrap?: boolean;
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (arg?: Arg) => {
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

	const env = std.env.arg(env_, prerequisites(build), { utils: false });

	const output = autotoolsInternal({
		build,
		host,
		bootstrap,
		env,
		phases: { configure },
		processName: metadata.name,
		sdk,
		source: source_ ?? source(),
		wrapBashScriptPaths: ["bin/gawkbug"],
	});

	return output;
};

export default build;

import * as bootstrap from "../bootstrap.tg.ts";

export const test = async () => {
	const host = bootstrap.toolchainTriple(std.triple.host());
	const sdk = await bootstrap.sdk(host);
	return build({ host, bootstrap: true, env: sdk });
};
