import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://jqlang.github.io/jq/",
	name: "jq",
	license: "https://github.com/jqlang/jq?tab=License-1-ov-file#readme",
	repository: "https://github.com/jqlang/jq",
	version: "1.7.1",
};

export const source = tg.target(async () => {
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

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
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

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({ packageDir: default_(), binaries: ["jq"], metadata });
	return true;
});
