import * as std from "../../tangram.ts";

export const metadata = {
	homepage: "https://libisl.sourceforge.io",
	name: "isl",
	version: "0.27",
};

export const source = async () => {
	const { homepage, name, version } = metadata;
	const extension = ".tar.xz";
	const checksum =
		"sha256:6d8babb59e7b672e8cb7870e874f3f7b813b6e00e6af3f8b04f7579965643d5c";
	return await std.download
		.extractArchive({ checksum, base: homepage, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
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
		env,
		host: host_,
		sdk,
		source: source_,
	} = arg ? await tg.resolve(arg) : {};

	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	const configure = {
		args: ["--disable-dependency-tracking"],
	};

	const output = await std.utils.autotoolsInternal({
		...(await std.triple.rotate({ build, host })),
		env,
		phases: { configure },
		sdk,
		// We need GMP to be available during the build.
		setRuntimeLibraryPath: true,
		source: source_ ?? source(),
	});

	return output;
};

export default build;

import * as bootstrap from "../../bootstrap.tg.ts";

export const test = async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const sdk = await bootstrap.sdk.arg(host);
	return await build({ host, sdk });
};
