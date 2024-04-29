import pcre2 from "tg:pcre2" with { path: "../pcre2" };
import pkgconfig from "tg:pkgconfig" with { path: "../pkgconfig" };
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
	rust?: tg.MaybeNestedArray<rust.Arg>;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
	host?: string;
};

export let b3sum = tg.target(async (arg?: Arg) => {
	let {
		build,
		env: env_,
		host,
		rust: rustArgs = [],
		source: source_,
		...rest
	} = arg ?? {};

	let env = [pkgconfig({ ...rest, build, env: env_, host }), env_];

	// Point to the b3sum subdirectory of the blake3 source.
	let sourceDir = tg.Directory.expect(source_ ?? (await source()));
	let b3sumSource = tg.symlink(tg`${sourceDir}/b3sum`);

	return rust.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
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
