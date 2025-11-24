import { cargo } from "rust" with { local: "../rust" };
import * as std from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://www.nushell.sh/",
	license: "MIT",
	name: "nushell",
	repository: "https://github.com/nushell/nushell",
	version: "0.108.0",
	tag: "nushell/0.108.0",
	provides: {
		binaries: ["nu"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:5995c211411ad1d5dd7da904b9db238a543958675b9e45f5e84fbdf217499eee";
	const owner = name;
	const repo = name;
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
	build?: string;
	cargo?: cargo.Arg;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		build: build_,
		cargo: cargoArg = {},
		env,
		host: host_,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;

	return cargo.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			sdk,
			source: source_ ?? source(),
		},
		cargoArg,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
