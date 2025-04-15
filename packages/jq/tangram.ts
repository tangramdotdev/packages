import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://jqlang.github.io/jq/",
	name: "jq",
	license: "https://github.com/jqlang/jq?tab=License-1-ov-file#readme",
	repository: "https://github.com/jqlang/jq",
	version: "1.7.1",
	provides: {
		binaries: ["jq"],
	},
};

export const source = tg.command(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:478c9ca129fd2e3443fe27314b455e211e0d8c60bc8ff7df703873deeee580c2";
	const extension = ".tar.gz";
	const base = `https://github.com/stedolan/${name}/releases/download/${name}-${version}`;
	return await std
		.download({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.command(async (...args: std.Args<Arg>) => {
	console.log("INSIDE HOST", await std.triple.host());
	const {
		autotools = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const configure = {
		args: ["--without-oniguruma", "--disable-maintainer-mode"],
	};

	const phases = { configure };

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

export const run = tg.command(async (...args: Array<tg.Value>) => {
	console.log("OUTSIDE HOST", await std.triple.host());
	const dir = await build.build();
	return await tg.run({ executable: tg.symlink(tg`${dir}/bin/jq`), args });
});

export const test = tg.command(async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
});
