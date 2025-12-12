import * as std from "../../tangram.ts";

export const metadata = {
	name: "zstd",
	version: "1.5.7",
	tag: "zstd/1.5.7",
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:5b331d961d6989dc21bb03397fc7a2a4d86bc65a14adc5ffbbce050354e30fd2";
	const owner = "facebook";
	const repo = name;
	const tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		compression: "zst",
		owner,
		repo,
		source: "release",
		tag,
		version,
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
		bootstrap: bootstrap_ = false,
		build: build_,
		env,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};

	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	const sourceDir = source_ ?? source();

	const install = tg`make install PREFIX=${tg.output}`;
	const phases = { install };

	return await std.autotools.build({
		build,
		host,
		bootstrap: bootstrap_,
		buildInTree: true,
		defaultCrossArgs: false,
		env,
		phases: { phases, order: ["prepare", "build", "install"] },
		prefixArg: "none",
		sdk,
		source: sourceDir,
	});
};

export default build;

import * as bootstrap from "../../bootstrap.tg.ts";

export const test = async () => {
	const host = bootstrap.toolchainTriple(std.triple.host());
	const sdkArg = await bootstrap.sdk.arg(host);
	// FIXME
	// await std.assert.pkg({ metadata, buildFn: build, libraries: ["zstd"] });
	return true;
};
