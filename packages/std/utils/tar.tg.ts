import * as std from "../tangram.ts";
import { autotoolsInternal, prerequisites } from "../utils.tg.ts";
import libiconv from "./libiconv.tg.ts";

export const metadata = {
	name: "tar",
	version: "1.35",
	tag: "tar/1.35",
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:4d62ff37342ec7aed748535323930c7cf94acf71c3591882b26a7ea50f3edc16";
	return std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});
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
	const os = std.triple.os(host);
	const build = build_ ?? host;

	const dependencies: Array<tg.Unresolved<std.env.Arg>> = [prerequisites(host)];
	let additionalEnv: tg.Unresolved<std.env.Arg> = {
		FORCE_UNSAFE_CONFIGURE: true,
	};
	if (os === "darwin") {
		dependencies.push(
			libiconv({ bootstrap: bootstrap_, build, env: env_, host, sdk }),
		);
		additionalEnv = {
			...additionalEnv,
			LDFLAGS: tg.Mutation.suffix("-liconv", " "),
		};
	}

	const configure = {
		args: ["--disable-dependency-tracking"],
	};

	const env = std.env.arg(env_, ...dependencies, additionalEnv, {
		utils: false,
	});

	const output = autotoolsInternal({
		build,
		host,
		bootstrap: bootstrap_,
		env,
		phases: { configure },
		processName: metadata.name,
		sdk,
		source: source_ ?? source(),
	});

	return output;
};

export default build;

import * as bootstrap from "../bootstrap.tg.ts";

export const test = async () => {
	const host = bootstrap.toolchainTriple(std.triple.host());
	const sdk = await bootstrap.sdk(host);
	return build({ host, bootstrap: true, env: sdk });
};
