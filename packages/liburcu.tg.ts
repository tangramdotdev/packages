import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://liburcu.org/",
	license: "LGPL-2.1-or-later",
	name: "liburcu",
	repository: "https://git.liburcu.org/userspace-rcu.git",
	version: "0.15.6",
	tag: "liburcu/0.15.6",
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

export async function source() {
	const { version } = metadata;
	const checksum =
		"sha256:850b192096eb11ebf2c70e8f97bc7da7479ee41da1bebeb44e3986908bac414f";
	const name = "userspace-rcu";
	const extension = ".tar.bz2";
	const base = "https://lttng.org/files/urcu";
	return std.download
		.extractArchive({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export type Arg = std.autotools.Arg;

export function build(...args: tg.Args<Arg>) {
	return std.autotools.build({ source: source() }, ...args);
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
