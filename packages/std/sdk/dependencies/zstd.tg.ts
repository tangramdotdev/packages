import * as std from "../../tangram.ts";

export const metadata = {
	name: "zstd",
	version: "1.5.6",
	provides: {
		binaries: ["zstd"],
		libraries: ["zstd"],
	},
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:4aa8dd1c1115c0fd6b6b66c35c7f6ce7bd58cc1dfd3e4f175b45b39e84b14352";
	const owner = "facebook";
	const repo = name;
	const tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		compressionFormat: "zst",
		owner,
		repo,
		source: "release",
		tag,
		version,
	});
});

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		build,
		env,
		host,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const sourceDir = source_ ?? source();

	const install = "make install PREFIX=$OUTPUT";
	const phases = { install };

	return await std.autotools.build({
		...(await std.triple.rotate({ build, host })),
		buildInTree: true,
		defaultCrossArgs: false,
		env,
		phases: { phases, order: ["prepare", "build", "install"] },
		prefixArg: "none",
		sdk: false,
		source: sourceDir,
	});
});

export default build;

import * as bootstrap from "../../bootstrap.tg.ts";
export const test = tg.target(async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const env = await bootstrap.sdk(host);
	const spec = {
		...std.assert.defaultSpec(metadata),
		bootstrapMode: true,
		env,
	};
	return await std.assert.pkg(build, spec);
});
