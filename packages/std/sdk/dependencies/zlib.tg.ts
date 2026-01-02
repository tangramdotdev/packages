import * as std from "../../tangram.ts";

export const metadata = {
	name: "zlib-ng",
	version: "2.3.2",
	tag: "zlib-ng/2.3.2",
};

export const source = () => {
	const { version } = metadata;
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

export type Arg = {
	bootstrap?: boolean;
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (arg?: Arg) => {
	const {
		bootstrap: bootstrap_ = false,
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};

	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	const envs = [env_];
	if (build !== host) {
		envs.push({
			CHOST: host,
		});
	}
	const env = std.env.arg(...envs, { utils: false });

	const output = std.utils.autotoolsInternal({
		build,
		host,
		bootstrap: bootstrap_,
		defaultCrossArgs: false,
		env,
		phases: {
			configure: {
				args: ["--zlib-compat"],
			},
		},
		processName: metadata.name,
		sdk,
		source: source_ ?? source(),
	});

	return output;
};

export default build;
