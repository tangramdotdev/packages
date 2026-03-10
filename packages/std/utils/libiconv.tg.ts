import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";

export const metadata = {
	name: "libiconv",
	version: "1.19",
	tag: "libiconv/1.19",
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:88dd96a8c0464eca144fc791ae60cd31cd8ee78321e67397e25fc095c4a19aa6";
	return std.download.fromGnu({ name, version, checksum });
};

export type Arg = {
	bootstrap?: boolean;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
	usePrerequisites?: boolean;
};

export const build = async (arg?: tg.Unresolved<Arg>) => {
	const {
		bootstrap: bootstrap_ = false,
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
		usePrerequisites = true,
	} = arg ? await tg.resolve(arg) : {};

	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	const configure = {
		args: ["--disable-dependency-tracking"],
	};

	const env: std.Args<std.env.Arg> = [];

	const envArg = usePrerequisites
		? std.env.arg(env_, ...env, prerequisites(build), { utils: false })
		: std.env.arg(...env, env_, { utils: false });

	const output = autotoolsInternal({
		build,
		host,
		bootstrap: bootstrap_,
		env: envArg,
		phases: { configure },
		processName: metadata.name,
		sdk,
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
