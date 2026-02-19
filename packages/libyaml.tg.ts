import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://pyyaml.org/wiki/LibYAML",
	license: "MIT",
	name: "libyaml",
	repository: "https://github.com/yaml/libyaml",
	version: "0.2.5",
	tag: "libyaml/0.2.5",
	provides: {
		libraries: [{ name: "yaml", pkgConfigName: false }],
	},
};

const source = () => {
	const { version } = metadata;
	const checksum =
		"sha256:c642ae9b75fee120b2d96c712538bd2cf283228d2337df2cf2988e3c02678ef4";
	const extension = ".tar.gz";
	const url = `https://github.com/yaml/libyaml/releases/download/${version}/yaml-${version}${extension}`;
	return std.download
		.extractArchive({ url, checksum })
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
