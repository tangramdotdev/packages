import * as std from "../../tangram.ts";

export const metadata = {
	homepage: "https://www.mpfr.org",
	name: "mpfr",
	version: "4.2.1",
	provides: {
		libraries: ["mpfr"],
	},
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:277807353a6726978996945af13e52829e3abd7a9a5b7fb2793894e18f1fcbb2";
	return std.download.fromGnu({
		checksum,
		name,
		version,
		compressionFormat: "xz",
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
