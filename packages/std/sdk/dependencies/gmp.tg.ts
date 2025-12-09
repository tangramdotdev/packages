import * as std from "../../tangram.ts";
import gcc15Patch from "./GMP_GCC15.patch" with { type: "file" };

export const metadata = {
	homepage: "https://gmplib.org",
	name: "gmp",
	version: "6.3.0",
	tag: "gmp/6.3.0",
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:a3c2b80201b89e68616f4ad30bc66aee4927c3ce50e33929ca819d5c43538898";
	return std.download
		.fromGnu({
			name,
			version,
			compression: "xz",
			checksum,
		})
		.then((dir) => bootstrap.patch(dir, gcc15Patch));
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
		env,
		host: host_,
		sdk,
		source: source_,
	} = arg ? await tg.resolve(arg) : {};

	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	const output = await std.utils.autotoolsInternal({
		...(await std.triple.rotate({ build, host })),
		bootstrap: bootstrap_,
		env,
		sdk,
		source: source_ ?? source(),
	});

	return output;
};

export default build;

import * as bootstrap from "../../bootstrap.tg.ts";

export const test = async () => {
	const host = bootstrap.toolchainTriple(std.triple.host());
	const sdk = await bootstrap.sdk.arg(host);
	return await build({ host, sdk });
};
