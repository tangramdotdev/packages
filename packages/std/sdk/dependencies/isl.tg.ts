import * as std from "../../tangram.ts";

export const metadata = {
	homepage: "https://libisl.sourceforge.io",
	name: "isl",
	version: "0.26",
	provides: {
		libraries: ["isl"],
	},
};

export const source = tg.target(async () => {
	const { homepage, name, version } = metadata;
	const extension = ".tar.xz";
	const checksum =
		"sha256:a0b5cb06d24f9fa9e77b55fabbe9a3c94a336190345c2555f9915bb38e976504";
	return await std
		.download({ checksum, base: homepage, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		build,
		env,
		host,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const configure = {
		args: ["--disable-dependency-tracking"],
	};

	const output = await std.utils.buildUtil({
		...(await std.triple.rotate({ build, host })),
		env,
		phases: { configure },
		sdk: false,
		// We need GMP to be available during the build.
		setRuntimeLibraryPath: true,
		source: source_ ?? source(),
	});

	return output;
});

export default build;

import * as bootstrap from "../../bootstrap.tg.ts";
export const test = tg.target(async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const env = await bootstrap.sdk(host);
	const spec = {
		...std.assert.defaultSpec(metadata),
		bootstrapMode: true,
		env,
	};
	return await std.assert.pkg(build, spec);
});
