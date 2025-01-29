import * as std from "../../tangram.ts";

export const metadata = {
	homepage: "https://www.multiprecision.org",
	name: "mpc",
	version: "1.3.1",
	provides: {
		libraries: ["mpc"],
	},
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:ab642492f5cf882b74aa0cb730cd410a81edcdbec895183ce930e706c1c759b8";
	return std.download.fromGnu({ checksum, name, version });
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

	const output = std.utils.buildUtil({
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
