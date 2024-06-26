import * as std from "../tangram.tg.ts";
import * as cmake from "./cmake.tg.ts";

export let metadata = {
	name: "ninja",
	version: "1.12.1",
};

export let source = () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:821bdff48a3f683bc4bb3b6f0b5fe7b2d647cf65d52aeb63328c91a6c6df285a";
	let owner = "ninja-build";
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

export let ninja = async (arg?: Arg) => {
	let { build: build_, host: host_, sdk, source: source_ } = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let configure = {
		args: ["-DCMAKE_BUILD_TYPE=Release", "-DBUILD_TESTING=OFF"],
	};

	let result = cmake.build({
		...(await std.triple.rotate({ build, host })),
		generator: "Unix Makefiles",
		phases: { configure },
		sdk,
		source: source_ ?? source(),
	});

	return result;
};

export default ninja;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: ninja,
		binaries: ["ninja"],
		metadata,
		sdk: {},
	});
	return true;
});
