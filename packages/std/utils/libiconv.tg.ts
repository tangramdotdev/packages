import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";

export const metadata = {
	name: "libiconv",
	version: "1.19",
	tag: "libiconv/1.19",
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:88dd96a8c0464eca144fc791ae60cd31cd8ee78321e67397e25fc095c4a19aa6";
	return std.download.fromGnu({ name, version, checksum });
}

export type Arg = {
	build?: string | null;
	env?: std.env.Arg | null;
	host?: string | null;
	sdk?: std.sdk.Arg | null;
	source?: tg.Directory | null;
	usePrerequisites?: boolean;
};

export async function build(arg?: tg.Unresolved<Arg>) {
	const {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
		usePrerequisites = true,
	} = arg ? await tg.resolve(arg) : {};

	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	const configure = {
		args: ["--disable-dependency-tracking"],
	};

	const env: tg.Args<std.env.Arg> = [];

	const envArg = usePrerequisites
		? std.env.compose(env_ ?? null, ...env, prerequisites(build))
		: std.env.compose(...env, env_ ?? null);

	const output = autotoolsInternal({
		build,
		host,
		env: envArg,
		phases: { configure },
		processName: metadata.name,
		...std.args.optional("sdk", sdk),
		source: source_ ?? source(),
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
