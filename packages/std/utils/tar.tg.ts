import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";
import libiconv from "./libiconv.tg.ts";

export let metadata = {
	name: "tar",
	version: "1.35",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:4d62ff37342ec7aed748535323930c7cf94acf71c3591882b26a7ea50f3edc16";
	return std.download.fromGnu({ name, version, compressionFormat, checksum });
});

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let dependencies: tg.Unresolved<std.env.Arg> = [prerequisites(host)];
	let additionalEnv = {};
	if (std.triple.os(build) === "darwin") {
		dependencies.push(libiconv({ ...rest, build, host }));
		// Bug: https://savannah.gnu.org/bugs/?64441.
		// Fix http://git.savannah.gnu.org/cgit/tar.git/commit/?id=8632df39
		// Remove in next release.
		additionalEnv = {
			...additionalEnv,
			LDFLAGS: tg.Mutation.templatePrepend(`-liconv`, " "),
		};
	}

	let configure = {
		args: ["--disable-dependency-tracking"],
	};

	let env = [env_, ...dependencies, additionalEnv];

	let output = buildUtil(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases: { configure },
			source: source_ ?? source(),
		},
		autotools,
	);

	return output;
});

export default build;

import * as bootstrap from "../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdkArg = await bootstrap.sdk.arg(host);
	let directory = build({ host, sdk: sdkArg });
	await std.assert.pkg({
		directory,
		binaries: ["tar"],
		metadata,
		sdk: sdkArg,
	});
	return directory;
});
