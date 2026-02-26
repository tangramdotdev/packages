import * as std from "../tangram.ts";

export const metadata = {
	name: "m4",
	version: "1.4.21",
	tag: "m4/1.4.21",
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:f25c6ab51548a73a75558742fb031e0625d6485fe5f9155949d6486a2408ab66";
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
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = arg ? await tg.resolve(arg) : {};

	const configure = {
		args: ["--disable-dependency-tracking"],
	};

	const env = std.env.arg(env_, { utils: false });

	const output = std.utils.autotoolsInternal({
		build,
		host,
		bootstrap: bootstrap_,
		env,
		fortifySource: 2,
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
	const sdkArg = await bootstrap.sdk.arg(host);
	// FIXME
	// await std.assert.pkg({ buildFn: build, binaries: ["m4"], metadata });
	return true;
};
