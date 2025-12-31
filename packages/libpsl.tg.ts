import * as python from "python" with { local: "./python" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://rockdaboot.github.io/libpsl/",
	license: "MIT",
	name: "libpsl",
	repository: "https://github.com/rockdaboot/libpsl",
	version: "0.21.5",
	tag: "libpsl/0.21.5",
	provides: {
		libraries: ["psl"],
	},
};

export const source = async (): Promise<tg.Directory> => {
	const { name, version } = metadata;
	const checksum =
		"sha256:1dcc9ceae8b128f3c0b3f654decd0e1e891afc6ff81098f227ef260449dae208";
	const owner = "rockdaboot";
	const repo = name;
	const tag = version;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "release",
		tag,
		version,
	});
};

const deps = std.deps({
	python: { build: python.self, kind: "buildtime" },
});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		{
			source: source(),
			deps,
			phases: {
				configure: {
					args: [
						"--disable-dependency-tracking",
						"--disable-nls",
						"--disable-rpath",
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
