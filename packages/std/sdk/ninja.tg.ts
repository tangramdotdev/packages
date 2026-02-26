import * as std from "../tangram.ts";
import * as cmake from "./cmake.tg.ts";

export const metadata = {
	name: "ninja",
	version: "1.13.2",
	tag: "ninja/1.13.2",
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:974d6b2f4eeefa25625d34da3cb36bdcebe7fbce40f4c16ac0835fd1c0cbae17";
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
		host: build,
		target: host,
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
