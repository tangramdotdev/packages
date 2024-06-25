import * as std from "../tangram.tg.ts";
import * as cmake from "./cmake.tg.ts";
import zstd from "./dependencies/zstd.tg.ts";

import blake3DisableNeonFlag from "./mold_blake3_disable_neon_flag.patch" with {
	type: "file",
};

export let metadata = {
	homepage: "https://github.com/rui314/mold",
	license: "MIT",
	name: "mold",
	repository: "https://github.com/rui314/mold",
	version: "2.32.0",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:4b7e4146ea0f52be9adae8b417399f3676a041e65b55e3f25f088120d30a320b";
	let owner = "rui314";
	let repo = name;
	let tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
	});
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let mold = tg.target(async (arg?: Arg) => {
	let {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let configure = {
		args: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_INSTALL_LIBDIR=lib"],
	};

	let sourceDir = source_ ?? (await source());
	// On aarch64, disable neon flag in blake3 build.
	if (std.triple.arch(host) === "aarch64") {
		sourceDir = await std.patch(sourceDir, blake3DisableNeonFlag);
	}

	let env = await std.env.arg(zstd({ build, host }), env_);

	let result = cmake.build({
		...(await std.triple.rotate({ build, host })),
		env,
		phases: { configure },
		sdk,
		source: sourceDir,
	});

	return result;
});

export default mold;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: mold,
		binaries: ["mold"],
		metadata,
	});
	return true;
});
