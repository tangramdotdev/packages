import * as std from "../../tangram.ts";

export const metadata = {
	name: "zlib",
	version: "1.3.1",
	tag: "zlib/1.3.1",
};

export const source = async () => {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const checksum =
		"sha256:38ef96b8dfe510d42707d9c781877914792541133e1870841463bfa73f883e32";
	const base = `https://zlib.net/`;
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
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
		bootstrap: bootstrap_ = false,
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};

	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	const envs = [env_];
	if (build !== host) {
		envs.push({
			CHOST: host,
		});
	}
	const env = std.env.arg(...envs, { utils: false });

	const output = std.utils.autotoolsInternal({
		build,
		host,
		bootstrap: bootstrap_,
		defaultCrossArgs: false,
		env,
		sdk,
		source: source_ ?? source(),
	});

	return output;
};

export default build;

import * as bootstrap from "../../bootstrap.tg.ts";

export const test = async () => {
	const host = bootstrap.toolchainTriple(std.triple.host());
	const sdkArg = await bootstrap.sdk.arg(host);
	// FIXME
	// await std.assert.pkg({ buildFn: build, libraries: ["z"] });
	return true;
};
