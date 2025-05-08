import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";
import disableLocatePatch from "./findutils-disable-locate.diff" with {
	type: "file",
};

export const metadata = {
	name: "findutils",
	version: "4.10.0",
};

export const source = async (os: string) => {
	const { name, version } = metadata;
	const checksum =
		"sha256:1387e0b67ff247d2abde998f90dfbf70c1491391a59ddfecb8ae698789f0a4f5";
	let source = await std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});

	// On macos, don't build locate/updatedb.
	if (os === "darwin") {
		source = await bootstrap.patch(source, disableLocatePatch);
	}
	return source;
};

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export const build = async (arg?: tg.Unresolved<Arg>) => {
	const {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ? await tg.resolve(arg) : {};
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;
	const os = std.triple.os(build);

	const wrapBashScriptPaths: Array<string> | undefined =
		os === "linux" ? ["bin/updatedb"] : undefined;

	const sourceDir = source_ ?? source(os);

	const configure = {
		args: ["--disable-dependency-tracking", "--disable-rpath"],
	};

	const env = std.env.arg(env_, prerequisites(build));

	const output = autotoolsInternal({
		...(await std.triple.rotate({ build, host })),
		env,
		phases: { configure },
		sdk,
		source: sourceDir,
		wrapBashScriptPaths,
	});

	return output;
};

export default build;

export const test = async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const sdk = await bootstrap.sdk(host);
	return build({ host, sdk: false, env: sdk });
};
