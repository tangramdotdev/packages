import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";

export const metadata = {
	name: "gzip",
	version: "1.15",
	tag: "gzip/1.15",
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:9aa0cc780dec156b8282844833b342ab7cb08c25d2cd9a1869cdd0df31deff48";
	return std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});
}

export type Arg = {
	build?: string | null;
	env?: std.env.Arg | null;
	host?: string | null;
	sdk?: std.sdk.Arg | null;
	source?: tg.Directory | null;
};

export async function build(arg?: tg.Unresolved<Arg>) {
	const {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ? await tg.resolve(arg) : {};

	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	const configure = {
		args: ["--disable-dependency-tracking"],
	};

	const env = std.env.compose(env_ ?? null, prerequisites(build));

	const output = autotoolsInternal({
		build,
		host,
		env,
		phases: { configure },
		processName: metadata.name,
		...std.args.optional("sdk", sdk),
		source: source_ ?? source(),
		wrapBashScriptPaths: [
			"bin/gunzip",
			"bin/gzexe",
			"bin/uncompress",
			"bin/zcat",
			"bin/zcmp",
			"bin/zdiff",
			"bin/zegrep",
			"bin/zfgrep",
			"bin/zforce",
			"bin/zgrep",
			"bin/zmore",
			"bin/znew",
		],
	});

	return output;
}

export default build;

import * as bootstrap from "../bootstrap.tg.ts";

export async function test() {
	const host = bootstrap.toolchainTriple(std.triple.host());
	const sdk = await bootstrap.sdk(host);
	return build({ host, sdk: "none", env: sdk });
}
