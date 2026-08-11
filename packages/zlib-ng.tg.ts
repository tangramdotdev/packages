import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "https://github.com/zlib-ng/zlib-ng",
	license: "Zlib",
	name: "zlib-ng",
	repository: "https://github.com/zlib-ng/zlib-ng",
	version: "2.3.3",
	tag: "zlib-ng/2.3.3",
	provides: {
		libraries: [{ name: "z", pkgConfigName: "zlib" }],
	},
};

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:f9c65aa9c852eb8255b636fd9f07ce1c406f061ec19a2e7d508b318ca0c907d1";
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
}

export type Arg = std.autotools.Arg;

export async function build(...args: tg.Args<Arg>) {
	const arg = await std.autotools.arg(
		{
			source: source(),
			defaultCrossArgs: false,
			defaultCrossEnv: false,
			phases: {
				configure: {
					args: ["--zlib-compat"],
				},
			},
		},
		...args,
	);

	const os = std.triple.os(arg.host);

	// Build package-specific env defaults (lower precedence than user env).
	const packageEnv: std.env.Arg = {};

	// Zlib-ng does not pick up the cross toolchain automatically, set CC.
	if (os === "linux" && arg.build !== arg.host) {
		packageEnv.CC = `${arg.host}-cc`;
	}

	return std.autotools.build({
		...arg,
		env: std.env.arg(packageEnv, arg.env ?? null),
	});
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
