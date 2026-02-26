import * as std from "std" with { local: "./std" };
import strchrConstFix from "./libxcrypt-strchr-const-fix.patch" with { type: "file" };

export const metadata = {
	homepage: "https://github.com/besser82/libxcrypt",
	name: "libxcrypt",
	license: "LGPL-2.1",
	repository: "https://github.com/besser82/libxcrypt",
	version: "4.5.2",
	tag: "libxcrypt/4.5.2",
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
		"sha256:71513a31c01a428bccd5367a32fd95f115d6dac50fb5b60c779d5c7942aec071";
	const source = std.download.fromGithub({
		checksum,
		compression: "xz",
		owner,
		source: "release",
		repo,
		tag,
		version,
	});
	return std.patch(source, strchrConstFix);
};

export type Arg = std.autotools.Arg;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		{
			source: source(),
			phases: {
				configure: { args: ["--disable-dependency-tracking"] },
			},
		},
		...args,
	);

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
