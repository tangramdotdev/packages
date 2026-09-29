import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";

export const metadata = {
	name: "xz",
	version: "5.8.4",
	tag: "xz/5.8.4",
};

export async function source() {
	const { name, version } = metadata;
	const extension = ".tar.gz";
	const checksum =
		"sha256:0014c7886930454fe8bd4228665b51af55eeae560ea135c9c4cd33f55b2591d9";
	const base = `https://github.com/tukaani-project/xz/releases/download/v${version}`;
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
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
		args: [
			"--disable-debug",
			"--disable-dependency-tracking",
			"--disable-nls",
			"--disable-silent-rules",
		],
	};

	const env = std.env.compose(env_ ?? null, prerequisites(build));

	return autotoolsInternal({
		build,
		host,
		env,
		phases: { configure },
		processName: metadata.name,
		...std.args.optional("sdk", sdk),
		source: source_ ?? source(),
		wrapBashScriptPaths: [
			"bin/xzdiff",
			"bin/xzgrep",
			"bin/xzless",
			"bin/xzmore",
		],
	});
}

export default build;

export async function test() {
	const host = bootstrap.toolchainTriple(std.triple.host());
	const sdk = await bootstrap.sdk(host);
	return build({ host, sdk: "none", env: sdk });
}
