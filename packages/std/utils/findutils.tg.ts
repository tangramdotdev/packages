import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";
import disableLocatePatch from "./findutils-disable-locate.diff" with { type: "file" };

export const metadata = {
	name: "findutils",
	version: "4.11.0",
	tag: "findutils/4.11.0",
};

export async function source(os: string) {
	const { name, version } = metadata;
	const checksum =
		"sha256:bfd19cb06cc71f3352d567e90284d8cdac02ac89774bbeadf0b533b0c11432fd";
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
	const os = std.triple.os(build);

	const wrapBashScriptPaths: Array<string> | undefined =
		os === "linux" ? ["bin/updatedb"] : undefined;

	const sourceDir = source_ ?? source(os);

	const configure = {
		args: ["--disable-dependency-tracking", "--disable-rpath"],
	};

	const env = std.env.compose(env_ ?? null, prerequisites(build));

	const output = autotoolsInternal({
		build,
		host,
		env,
		phases: { configure },
		processName: metadata.name,
		...std.args.optional("sdk", sdk),
		source: sourceDir,
		...(wrapBashScriptPaths !== undefined ? { wrapBashScriptPaths } : {}),
	});

	return output;
}

export default build;

export async function test() {
	const host = bootstrap.toolchainTriple(std.triple.host());
	const sdk = await bootstrap.sdk(host);
	return build({ host, sdk: "none", env: sdk });
}
