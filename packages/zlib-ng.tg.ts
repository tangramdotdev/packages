import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://github.com/zlib-ng/zlib-ng",
	license: "Zlib",
	name: "zlib-ng",
	repository: "https://github.com/zlib-ng/zlib-ng",
	version: "2.3.2",
	tag: "zlib-ng/2.3.2",
	provides: {
		libraries: [{ name: "z", pkgConfigName: "zlib" }],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:6a0561b50b8f5f6434a6a9e667a67026f2b2064a1ffa959c6b2dae320161c2a8";
	const owner = "zlib-ng";
	const repo = "zlib-ng";
	const tag = version;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
	});
};

export type Arg = std.autotools.Arg;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		{
			source: source(),
			phases: {
				configure: {
					args: ["--zlib-compat"],
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
