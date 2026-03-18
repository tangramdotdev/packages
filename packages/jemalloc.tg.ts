import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://jemalloc.net/",
	license: "BSD-2-Clause",
	name: "jemalloc",
	repository: "https://github.com/jemalloc/jemalloc",
	version: "5.3.0",
	tag: "jemalloc/5.3.0",
	provides: {
		headers: ["jemalloc/jemalloc.h"],
		libraries: ["jemalloc"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:2db82d1e7119df3e71b7640219b6dfe84789bc0537983c3b7ac4f7189aecfeaa";
	const owner = name;
	const repo = name;
	const tag = version;
	return std.download.fromGithub({
		checksum,
		compression: "bz2",
		owner,
		repo,
		source: "release",
		tag,
		version,
	});
};

export type Arg = std.autotools.Arg;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build({ source: source() }, ...args);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
