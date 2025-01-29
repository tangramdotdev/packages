import * as std from "../../tangram.ts";

export const metadata = {
	name: "zlib",
	version: "1.3.1",
	provides: {
		libraries: ["z"],
	},
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const checksum =
		"sha256:38ef96b8dfe510d42707d9c781877914792541133e1870841463bfa73f883e32";
	const base = `https://zlib.net/`;
	return await std
		.download({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
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
		env: env_,
		host,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const envs = [env_];
	if (build !== host) {
		envs.push({
			CHOST: host,
		});
	}
	const env = std.env.arg(...envs);

	const output = std.utils.buildUtil({
		...(await std.triple.rotate({ build, host })),
		defaultCrossArgs: false,
		env,
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
