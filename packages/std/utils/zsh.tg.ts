import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

export const metadata = {
	homepage: "https://www.zsh.org/",
	license: "https://sourceforge.net/p/zsh/code/ci/master/tree/LICENCE",
	name: "zsh",
	repository: "https://sourceforge.net/p/zsh/code/ci/master/tree/",
	version: "5.9",
};

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const url = `https://sourceforge.net/projects/zsh/files/zsh/5.9/${name}-${version}.tar.xz/download`;
	const checksum =
		"sha256:9b8d1ecedd5b5e81fbf1918e876752a7dd948e05c1a0dba10ab863842d45acd5";
	return await std
		.download({ url, checksum, decompress: "xz", extract: "tar" })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export const build = tg.target(async (arg?: Arg) => {
	const {
		build: build_,
		env: env_ = [],
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};

	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const configureArgs = ["--enable-multibyte"];

	const configure = {
		args: configureArgs,
	};
	const phases = { configure };

	const env: tg.Unresolved<std.Args<std.env.Arg>> = [env_];
	env.push(prerequisites(build));
	env.push(bootstrap.shell(host));

	let output = buildUtil({
		...(await std.triple.rotate({ build, host })),
		env: std.env.arg(env),
		phases,
		sdk,
		source: source_ ?? source(),
	});

	return output;
});

export default build;

export const test = tg.target(async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const sdk = await bootstrap.sdk(host);
	return build({ host, sdk: false, env: sdk });
});
