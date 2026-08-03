import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";
import libiconv from "./libiconv.tg.ts";

export const metadata = {
	name: "tar",
	version: "1.35",
	tag: "tar/1.35",
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:4d62ff37342ec7aed748535323930c7cf94acf71c3591882b26a7ea50f3edc16";
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
	const os = std.triple.os(host);
	const build = build_ ?? host;

	const dependencies: tg.Args<std.env.Arg> = [prerequisites(host)];
	let additionalEnv: tg.Unresolved<std.env.Arg> = {
		FORCE_UNSAFE_CONFIGURE: true,
	};
	if (os === "darwin") {
		dependencies.push(
			libiconv({
				build,
				...std.args.optional("env", env_),
				host,
				...std.args.optional("sdk", sdk),
			}),
		);
		additionalEnv = {
			...additionalEnv,
			LDFLAGS: tg.Mutation.suffix("-liconv", " "),
		};
	}

	const configure = {
		args: ["--disable-dependency-tracking"],
	};

	const env = std.env.compose(env_ ?? null, ...dependencies, additionalEnv);

	const output = autotoolsInternal({
		build,
		host,
		env,
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
