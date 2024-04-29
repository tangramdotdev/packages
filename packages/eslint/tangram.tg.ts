import * as node from "tg:nodejs" with { path: "../nodejs" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	home: "https://eslint.org",
	license: "MIT",
	name: "eslint",
	repository: "https://github.com/eslint/eslint",
	version: "9.1.1",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:4f39cb81c3540cbb5e0ccbbb7afff672fec31ac835b1f0be9bbf353083c61b38";
	let owner = name;
	let repo = name;
	let tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "tag",
		tag,
	});
});

export type Arg = {
	env?: std.env.Arg;
	host?: string;
	nodejs?: tg.MaybeNestedArray<node.Arg>;
	source?: tg.Directory;
};

export let eslint = tg.target((arg?: Arg) => {
	let { nodejs = [], source: source_, ...rest } = arg ?? {};
	let phases = { build: tg.Mutation.unset() };

	// Build the binaries provided by eslint.
	return node.build(
		{
			...rest,
			packageLock: tg.include("./package-lock.json").then(tg.File.expect),
			phases,
			source: source_ ?? source(),
		},
		nodejs,
	);
});

export default eslint;

export let test = tg.target(() => {
	return std.build(
		`
			echo "Checking that we can run eslint." | tee $OUTPUT
			echo "$(eslint --version)" | tee -a $OUTPUT
		`,
		{ env: eslint() },
	);
});
