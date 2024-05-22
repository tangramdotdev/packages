import * as std from "../tangram.tg.ts";
import * as cmake from "./cmake.tg.ts";
import zstd from "./dependencies/zstd.tg.ts";

export let metadata = {
	homepage: "https://github.com/rui314/mold",
	license: "MIT",
	name: "mold",
	repository: "https://github.com/rui314/mold",
	version: "2.31.0",
};

export let source = () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:3dc3af83a5d22a4b29971bfad17261851d426961c665480e2ca294e5c74aa1e5";
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
};

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let mold = async (arg?: Arg) => {
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

	let env = await std.env.arg(zstd({ build, host }), env_);

	let result = cmake.build({
		...std.triple.rotate({ build, host }),
		env,
		phases: { configure },
		sdk,
		source: source_ ?? source(),
	});

	return result;
};

export default mold;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: mold,
		binaries: ["mold"],
		metadata,
	});
	return true;
});
