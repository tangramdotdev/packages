import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";

export const metadata = {
	name: "grep",
	version: "3.12",
	tag: "grep/3.12",
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:2649b27c0e90e632eadcd757be06c6e9a4f48d941de51e7c0f83ff76408a07b9";
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
		args: [
			"--disable-dependency-tracking",
			"--disable-perl-regexp",
			"--disable-nls",
			"--disable-rpath",
		],
	};

	const env = std.env.arg(env_, prerequisites(host), { utils: false });

	const output = autotoolsInternal({
		...(await std.triple.rotate({ build, host })),
		bootstrap: bootstrap_,
		env,
		phases: { configure },
		sdk,
		source: source_ ?? source(),
		wrapBashScriptPaths: ["bin/egrep", "bin/fgrep"],
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
