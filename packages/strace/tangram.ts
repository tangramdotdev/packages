import * as std from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://github.com/strace/strace",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	name: "strace",
	license: "https://github.com/strace/strace/blob/master/COPYING",
	repository: "https://github.com/strace/strace",
	version: "6.10",
	provides: {
		binaries: ["strace"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const owner = name;
	const repo = name;
	const tag = `v${version}`;
	const checksum =
		"sha256:765ec71aa1de2fe37363c1e40c7b7669fc1d40c44bb5d38ba8e8cd82c4edcf07";
	return std.download.fromGithub({
		checksum,
		compression: "xz",
		owner,
		repo,
		tag,
		source: "release",
		version,
	});
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	std.assert.supportedHost(host, metadata);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
