import * as std from "../../tangram.ts";
import * as bootstrap from "../../bootstrap.tg.ts";
import strchrConstFix from "./libxcrypt-strchr-const-fix.patch" with { type: "file" };

export const metadata = {
	homepage: "https://github.com/besser82/libxcrypt",
	name: "libxcrypt",
	license: "LGPL-2.1",
	repository: "https://github.com/besser82/libxcrypt",
	version: "4.5.2",
	tag: "libxcrypt/4.5.2",
};

export const source = () => {
	const { name, version } = metadata;
	const owner = "besser82";
	const repo = name;
	const tag = `v${version}`;
	const checksum =
		"sha256:71513a31c01a428bccd5367a32fd95f115d6dac50fb5b60c779d5c7942aec071";
	return std.download
		.fromGithub({
			checksum,
			compression: "xz",
			owner,
			source: "release",
			repo,
			tag,
			version,
		})
		.then((dir) => bootstrap.patch(dir, strchrConstFix));
};

export type Arg = std.autotools.Arg;

export const build = async (...args: std.Args<Arg>) => {
	return std.autotools.build(
		{
			source: source(),
			phases: {
				configure: {
					args: ["--disable-dependency-tracking"],
				},
			},
		},
		...args,
	);
};

export default build;

export const test = async () => {
	const host = bootstrap.toolchainTriple(std.triple.host());
	const sdkArg = await bootstrap.sdk.arg(host);
	// FIXME
	// await std.assert.pkg({ metadata, buildFn: build, libraries: ["xcrypt"] });
	return true;
};
