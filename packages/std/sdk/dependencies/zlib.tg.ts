import * as std from "../../tangram.ts";

export const metadata = {
	name: "zlib-ng",
	version: "2.3.3",
	tag: "zlib-ng/2.3.3",
};

export const source = () => {
	const { version } = metadata;
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
};

export type Arg = std.autotools.Arg;

export const build = async (...args: std.Args<Arg>) => {
	// Resolve args first to access build/host for cross-compilation.
	const resolved = await std.autotools.arg({ source: source() }, ...args);
	const host = resolved.host ?? std.triple.host();
	const build = resolved.build ?? host;

	const envs: std.Args<std.env.Arg> = [resolved.env];
	if (build !== host) {
		envs.push({ CHOST: host });
	}
	const env = await std.env.arg(...envs, { utils: false });

	return std.autotools.build({
		...resolved,
		env,
		defaultCrossArgs: false,
		phases: {
			configure: {
				args: ["--zlib-compat"],
			},
		},
	});
};

export default build;
