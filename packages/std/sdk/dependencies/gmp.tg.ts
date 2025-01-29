import * as std from "../../tangram.ts";

export const metadata = {
	homepage: "https://gmplib.org",
	name: "gmp",
	version: "6.3.0",
	provides: {
		libraries: ["gmp"],
	},
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:a3c2b80201b89e68616f4ad30bc66aee4927c3ce50e33929ca819d5c43538898";
	return std.download.fromGnu({
		name,
		version,
		compressionFormat: "xz",
		checksum,
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

	const configure = {
		args: ["--disable-dependency-tracking"],
	};

	const output = await std.utils.buildUtil({
		...(await std.triple.rotate({ build, host })),
		env,
		phases: { configure },
		sdk: false,
		source: source_ ?? source(),
	});

	return output;
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
