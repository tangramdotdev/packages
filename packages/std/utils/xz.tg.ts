import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";

export const metadata = {
	name: "xz",
	version: "5.8.1",
	tag: "xz/5.8.1",
};

export const source = async () => {
	const { name, version } = metadata;
	const extension = ".tar.gz";
	const checksum =
		"sha256:507825b599356c10dca1cd720c9d0d0c9d5400b9de300af00e4d1ea150795543";
	const base = `https://github.com/tukaani-project/xz/releases/download/v${version}`;
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = {
	bootstrap?: boolean;
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (arg?: tg.Unresolved<Arg>) => {
	const {
		bootstrap: bootstrap_ = false,
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ? await tg.resolve(arg) : {};
	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	const configure = {
		args: [
			"--disable-debug",
			"--disable-dependency-tracking",
			"--disable-nls",
			"--disable-silent-rules",
		],
	};

	const env = std.env.arg(env_, prerequisites(build), { utils: false });

	return autotoolsInternal({
		build,
		host,
		bootstrap: bootstrap_,
		env,
		phases: { configure },
		sdk,
		source: source_ ?? source(),
		wrapBashScriptPaths: [
			"bin/xzdiff",
			"bin/xzgrep",
			"bin/xzless",
			"bin/xzmore",
		],
	});
};

export default build;

export const test = async () => {
	const host = bootstrap.toolchainTriple(std.triple.host());
	const sdk = await bootstrap.sdk(host);
	return build({ host, bootstrap: true, env: sdk });
};
