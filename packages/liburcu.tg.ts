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

export type Arg = std.autotools.Arg;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build({ source: source() }, ...args);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
