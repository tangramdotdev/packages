import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://github.com/besser82/libxcrypt",
	name: "libxcrypt",
	license: "LGPL-2.1",
	repository: "https://github.com/besser82/libxcrypt",
	version: "4.4.38",
	tag: "libxcrypt/4.4.38",
	provides: {
		headers: ["crypt.h"],
		libraries: ["crypt"],
	},
};

const source = () => {
	const { name, version } = metadata;
	const owner = "besser82";
	const repo = name;
	const tag = `v${version}`;
	const checksum =
		"sha256:80304b9c306ea799327f01d9a7549bdb28317789182631f1b54f4511b4206dd6";
	return std.download.fromGithub({
		checksum,
		compression: "xz",
		owner,
		source: "release",
		repo,
		tag,
		version,
	});
};

export type Arg = std.autotools.Arg;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		std.autotools.arg(
			{
				source: source(),
				phases: {
					configure: { args: ["--disable-dependency-tracking"] },
				},
			},
			...args,
		),
	);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
