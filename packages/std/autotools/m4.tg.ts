import * as std from "../tangram.ts";

export const metadata = {
	name: "m4",
	version: "1.4.20",
	tag: "m4/1.4.20",
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:e236ea3a1ccf5f6c270b1c4bb60726f371fa49459a8eaaebc90b216b328daf2b";
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

	const env = std.env.arg(
		{ CFLAGS: tg.Mutation.suffix("-std=gnu17", " ") },
		env_,
		{ utils: false },
	);

	const output = std.utils.autotoolsInternal({
		...(await std.triple.rotate({ build, host })),
		bootstrap: bootstrap_,
		env,
		fortifySource: 2,
		phases: { configure },
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
