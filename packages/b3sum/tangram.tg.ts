import * as rust from "tg:rust" with { path: "../rust" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://github.com/BLAKE3-team/BLAKE3",
	license: "CC0-1.0",
	name: "blake3",
	repository: "https://github.com/BLAKE3-team/BLAKE3",
	version: "1.5.1",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:822cd37f70152e5985433d2c50c8f6b2ec83aaf11aa31be9fe71486a91744f37";
	let owner = "BLAKE3-team";
	let repo = name;
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
	env?: std.env.Arg;
	host?: string;
	rust?: rust.Arg;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let b3sum = tg.target(async (...args: std.Args<Arg>) => {
	let {
		build,
		host,
		rust: rustArgs = {},
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	// Point to the b3sum subdirectory of the blake3 source.
	let sourceDir = tg.Directory.expect(source_ ?? (await source()));
	let b3sumSource = tg.symlink(tg`${sourceDir}/b3sum`);

	return rust.build(
		{
			...std.triple.rotate({ build, host }),
			sdk,
			source: b3sumSource,
		},
		rustArgs,
	);
});

export default b3sum;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: b3sum,
		binaries: ["b3sum"],
		metadata,
	});
	return b3sum();
});
