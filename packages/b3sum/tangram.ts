import { cargo } from "rust" with { path: "../rust" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://github.com/BLAKE3-team/BLAKE3",
	license: "CC0-1.0",
	name: "blake3",
	repository: "https://github.com/BLAKE3-team/BLAKE3",
	version: "1.5.5",
	provides: {
		binaries: ["b3sum"],
	},
};

export const source = tg.command(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:6feba0750efc1a99a79fb9a495e2628b5cd1603e15f56a06b1d6cb13ac55c618";
	const owner = "BLAKE3-team";
	const repo = name;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag: version,
	});
});

type Arg = {
	build?: string;
	cargo?: cargo.Arg;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.command(async (...args: std.Args<Arg>) => {
	const {
		build,
		host,
		cargo: cargoArgs = {},
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	return cargo.build(
		{
			...(await std.triple.rotate({ build, host })),
			manifestSubdir: "b3sum",
			sdk,
			source: source_ ?? source(),
		},
		cargoArgs,
	);
});

export default build;
export const test = tg.command(async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
});
