import { cargo } from "rust" with { path: "../rust" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://github.com/BLAKE3-team/BLAKE3",
	license: "CC0-1.0",
	name: "blake3",
	repository: "https://github.com/BLAKE3-team/BLAKE3",
	version: "1.5.1",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:822cd37f70152e5985433d2c50c8f6b2ec83aaf11aa31be9fe71486a91744f37";
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

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
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

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({
		packageDir: default_(),
		binaries: ["b3sum"],
		metadata,
	});
	return default_();
});
