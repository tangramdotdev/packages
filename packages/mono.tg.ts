import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.mono-project.com/",
	license: "MIT",
	name: "mono",
	repository: "https://github.com/mono/mono",
	version: "6.12.0.199",
	tag: "mono/6.12.0.199",
	provides: {
		binaries: ["mono", "mcs"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum = "sha256:none";
	const url = `https://download.mono-project.com/sources/${name}/${name}-${version}.tar.xz`;
	return std.download
		.extractArchive({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = std.autotools.Arg;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		{
			source: source(),
			buildInTree: true,
			phases: {
				configure: {
					args: [
						"--disable-dependency-tracking",
						"--disable-boehm",
						"--with-mcs-docs=no",
					],
				},
			},
		},
		...args,
	);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
