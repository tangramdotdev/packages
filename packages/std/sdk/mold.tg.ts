import * as std from "../tangram.ts";
import * as cmake from "./cmake.tg.ts";
import zstd from "./dependencies/zstd.tg.ts";

import blake3DisableNeonFlag from "./mold_blake3_disable_neon_flag.patch" with {
	type: "file",
};

export const metadata = {
	homepage: "https://github.com/rui314/mold",
	license: "MIT",
	name: "mold",
	repository: "https://github.com/rui314/mold",
	version: "2.33.0",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:37b3aacbd9b6accf581b92ba1a98ca418672ae330b78fe56ae542c2dcb10a155";
	const owner = "rui314";
	const repo = name;
	const tag = `v${version}`;
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

export const mold = tg.target(async (arg?: Arg) => {
	const {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const configure = {
		args: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_INSTALL_LIBDIR=lib"],
	};

	let sourceDir = source_ ?? (await source());
	// On aarch64, disable neon flag in blake3 build.
	if (std.triple.arch(host) === "aarch64") {
		sourceDir = await std.patch(sourceDir, blake3DisableNeonFlag);
	}

	const env = await std.env.arg(zstd({ build, host }), env_);

	const result = cmake.build({
		...(await std.triple.rotate({ build, host })),
		env,
		phases: { configure },
		sdk,
		source: sourceDir,
	});

	return result;
});

export default mold;

export const test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: mold,
		binaries: ["mold"],
		metadata,
	});
	return true;
});
