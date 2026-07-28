import * as std from "../tangram.ts";
import * as cmake from "./cmake.tg.ts";
import zstd from "./dependencies/zstd.tg.ts";

import blake3DisableNeonFlag from "./mold_blake3_disable_neon_flag.patch" with { type: "file" };

export const metadata = {
	homepage: "https://github.com/rui314/mold",
	license: "MIT",
	name: "mold",
	repository: "https://github.com/rui314/mold",
	version: "2.41.0",
	tag: "mold/2.41.0",
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:0a61abac85d818437b425df856822e9d6e9982baeae5a93bcb02fe6c0060c61a";
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
}

export type Arg = {
	build?: string | null;
	env?: std.env.Arg | null;
	host?: string | null;
	sdk?: std.sdk.Arg | null;
	source?: tg.Directory | null;
};

export async function mold(...args: tg.Args<Arg>) {
	const {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = await std.args.apply<Arg, Arg>({
		args,
		map: async (a) => a,
		reduce: {},
	});
	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	const configure = {
		args: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_INSTALL_LIBDIR=lib"],
	};

	let sourceDir = source_ ?? (await source());
	// On aarch64, disable neon flag in blake3 build.
	if (std.triple.arch(host) === "aarch64") {
		sourceDir = await std.patch(sourceDir, blake3DisableNeonFlag);
	}

	const env = await std.env.arg(zstd({ build, host }), env_ ?? null, {
		utils: false,
	});

	const result = cmake.build({
		host: build,
		target: host,
		env,
		phases: { configure },
		...(sdk !== undefined && sdk !== null ? { sdk } : {}),
		source: sourceDir,
	});

	return result;
}

export default mold;

export async function test() {
	// FIXME
	// await std.assert.pkg({ buildFn: mold, binaries: ["mold"], metadata });
	return true;
}
