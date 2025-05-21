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

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:478c9ca129fd2e3443fe27314b455e211e0d8c60bc8ff7df703873deeee580c2";
	const extension = ".tar.gz";
	const base = `https://github.com/stedolan/${name}/releases/download/${name}-${version}`;
	return await std.download
		.extractArchive({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const configure = {
		args: ["--without-oniguruma", "--disable-maintainer-mode"],
	};

	const phases = { configure };

	const env = std.env.arg(
		{ CFLAGS: tg.Mutation.suffix("-std=gnu17", " ") },
		env_,
	);

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
};

export default build;

export const env = async (...args: Array<tg.Value>) => {
	const executable = await tg.build(std.env, build());
	return await tg.run({ executable, args });
};

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
