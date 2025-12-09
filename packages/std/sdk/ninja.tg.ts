import * as std from "../tangram.ts";
import * as cmake from "./cmake.tg.ts";

export const metadata = {
	name: "ninja",
	version: "1.13.1",
	tag: "ninja/1.13.1",
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:f0055ad0369bf2e372955ba55128d000cfcc21777057806015b45e4accbebf23";
	const owner = "ninja-build";
	const repo = name;
	const tag = `v${version}`;
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

export const ninja = async (arg?: tg.Unresolved<Arg>) => {
	const {
		build: build_,
		host: host_,
		sdk,
		source: source_,
	} = arg ? await tg.resolve(arg) : {};
	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	const configure = {
		args: ["-DCMAKE_BUILD_TYPE=Release", "-DBUILD_TESTING=OFF"],
	};

	const result = cmake.build({
		...(await std.triple.rotate({ build, host })),
		generator: "Unix Makefiles",
		phases: { configure },
		sdk,
		source: source_ ?? source(),
	});

	return result;
};

export default ninja;

export const test = async () => {
	// FIXME
	// await std.assert.pkg({ buildFn: ninja, binaries: ["ninja"], metadata });
	return true;
};
