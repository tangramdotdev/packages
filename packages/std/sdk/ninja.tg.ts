import * as std from "../tangram.ts";
import * as cmake from "./cmake.tg.ts";

export const metadata = {
	name: "ninja",
	version: "1.13.2",
	tag: "ninja/1.13.2",
};

export function source() {
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
}

export type Arg = {
	build?: string | null;
	env?: std.env.Arg | null;
	host?: string | null;
	sdk?: std.sdk.Arg | null;
	source?: tg.Directory | null;
};

export async function ninja(...args: tg.Args<Arg>) {
	const {
		build: build_,
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
		args: ["-DCMAKE_BUILD_TYPE=Release", "-DBUILD_TESTING=OFF"],
	};

	const result = cmake.build({
		host: build,
		target: host,
		generator: "Unix Makefiles",
		phases: { configure },
		...(sdk !== undefined && sdk !== null ? { sdk } : {}),
		source: source_ ?? source(),
	});

	return result;
}

export default ninja;

export async function test() {
	// FIXME
	// await std.assert.pkg({ buildFn: ninja, binaries: ["ninja"], metadata });
	return true;
}
