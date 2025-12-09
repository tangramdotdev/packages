import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";

const metadata = {
	name: "diffutils",
	version: "3.12",
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:7c8b7f9fc8609141fdea9cece85249d308624391ff61dedaf528fcb337727dfd";
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

export const build = async (arg?: tg.Unresolved<Arg>) => {
	const {
		bootstrap: bootstrap_ = false,
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ? await tg.resolve(arg) : {};

	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	const configure = {
		args: ["--disable-dependency-tracking", "--disable-rpath"],
	};

	const env = std.env.arg(env_, prerequisites(build), { utils: false });

	const output = autotoolsInternal({
		...(await std.triple.rotate({ build, host })),
		bootstrap: bootstrap_,
		env,
		sdk,
		phases: { configure },
		source: source_ ?? source(),
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
