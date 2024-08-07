import * as std from "../../tangram.tg.ts";

export let metadata = {
	homepage: "https://libisl.sourceforge.io",
	name: "isl",
	version: "0.26",
};

export let source = tg.target(async () => {
	let { homepage, name, version } = metadata;
	let extension = ".tar.xz";
	let checksum =
		"sha256:a0b5cb06d24f9fa9e77b55fabbe9a3c94a336190345c2555f9915bb38e976504";
	return await std
		.download({ checksum, base: homepage, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let { build, env, host, sdk, source: source_ } = arg ?? {};

	let configure = {
		args: ["--disable-dependency-tracking"],
	};

	let output = await std.utils.buildUtil({
		...(await std.triple.rotate({ build, host })),
		env,
		phases: { configure },
		sdk,
		// We need GMP to be available during the build.
		setRuntimeLibraryPath: true,
		source: source_ ?? source(),
	});

	return output;
});

export default build;

import * as bootstrap from "../../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdk = await bootstrap.sdk.arg(host);
	return await build({ host, sdk });
});
