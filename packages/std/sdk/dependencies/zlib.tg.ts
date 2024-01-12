import * as std from "../../tangram.tg.ts";
import make from "./make.tg.ts";

export let metadata = {
	name: "zlib",
	version: "1.3",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let unpackFormat = ".tar.xz" as const;
	let packageArchive = std.download.packageArchive({
		name,
		version,
		unpackFormat,
	});

	let checksum =
		"sha256:8a9ba2898e1d0d774eca6ba5b4627a11e5588ba85c8851336eb38de4683050a7";
	let url = `https://zlib.net/${packageArchive}`;
	let outer = tg.Directory.expect(
		await std.download({ url, checksum, unpackFormat }),
	);
	return await std.directory.unwrap(outer);
});

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
};

export let build = tg.target((arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let env = [std.utils.env(arg), make(arg), env_];

	let output = std.utils.buildUtil(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			env,
			source: source_ ?? source(),
		},
		autotools,
	);

	return output;
});

export default build;

import * as bootstrap from "../../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = bootstrap.toolchainTriple(await std.Triple.host());
	await std.assert.pkg({
		directory: build({ host, sdk: { bootstrapMode: true } }),
		libs: ["z"],
	});
	return true;
});
