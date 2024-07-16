import * as std from "../../tangram.tg.ts";

export let metadata = {
	homepage: "https://gmplib.org",
	name: "gmp",
	version: "6.3.0",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:a3c2b80201b89e68616f4ad30bc66aee4927c3ce50e33929ca819d5c43538898";
	return std.download.fromGnu({
		name,
		version,
		compressionFormat: "xz",
		checksum,
	});
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let { build, env, host, sdk, source: source_ } = arg ?? {};

	let configure = {
		args: ["--disable-dependency-tracking"],
	};

	let output = await std.utils.buildUtil({
		...(await std.triple.rotate({ build, host })),
		env,
		phases: { configure },
		sdk,
		source: source_ ?? source(),
	});

	// Remove all libtool archives.
	for await (let [path, _artifact] of output.walk()) {
		if (path.toString().endsWith(".la")) {
			output = await tg.directory(output, {
				[`${path}`]: undefined,
			});
		}
	}

	return output;
});

export default build;

import * as bootstrap from "../../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdk = await bootstrap.sdk.arg(host);
	return await build({ host, sdk });
});
