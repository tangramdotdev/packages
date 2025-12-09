import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://liburcu.org/",
	license: "LGPL-2.1-or-later",
	name: "liburcu",
	repository: "https://git.liburcu.org/userspace-rcu.git",
	version: "0.15.5",
	tag: "liburcu/0.15.5",
	provides: {
		libraries: [
			"urcu",
			"urcu-bp",
			"urcu-cds",
			"urcu-mb",
			"urcu-memb",
			"urcu-qsbr",
		],
	},
};

export const source = async () => {
	const { version } = metadata;
	const checksum =
		"sha256:b2f787a8a83512c32599e71cdabcc5131464947b82014896bd11413b2d782de1";
	const name = "userspace-rcu";
	const extension = ".tar.bz2";
	const base = "https://lttng.org/files/urcu";
	return std.download
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
		env,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
