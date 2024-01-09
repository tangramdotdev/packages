import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { buildUtil } from "../utils.tg.ts";
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
	let host = await std.Triple.host(host_);
	let build = build_ ? std.triple(build_) : host;

	// On macOS, libiconv is already in the env, but the -liconv flag is missing
	// Bug: https://savannah.gnu.org/bugs/?64441.
	// Fix http://git.savannah.gnu.org/cgit/tar.git/commit/?id=8632df39
	// Remove in next release.
	let dependencies = [bootstrap.make.build(arg)];
	let additionalEnv = {};
	if (build.os === "darwin") {
		dependencies.push(libiconv(arg));
		additionalEnv = {
			LDFLAGS: "-liconv",
		};
	}

	let configure = {
		args: ["--disable-dependency-tracking"],
	};

	let env = [...dependencies, additionalEnv, env_];

	let output = buildUtil(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			env,
			phases: { configure },
			source: source_ ?? source(),
		},
		autotools,
	);

	return output;
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		directory: build({ sdk: { bootstrapMode: true } }),
		binaries: ["tar"],
		metadata,
	});
	return true;
});
