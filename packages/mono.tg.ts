import * as cmake from "cmake" with { local: "./cmake" };
import python from "python" with { local: "./python" };
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

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:c0850d545353a6ba2238d45f0914490c6a14a0017f151d3905b558f033478ef5";
	const url = `https://download.mono-project.com/sources/${name}/${name}-${version}.tar.xz`;
	return std.download
		.extractArchive({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export const deps = () =>
	std.deps({
		cmake: { build: cmake.self, kind: "full" },
		python: { build: python, kind: "buildtime" },
	});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		{
			source: source(),
			deps,
			buildInTree: true,
			phases: {
				configure: {
					args: [
						"--disable-dependency-tracking",
						"--disable-boehm",
						"--disable-btls",
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
