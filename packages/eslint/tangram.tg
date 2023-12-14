import * as node from "tg:nodejs" with { path: "../nodejs" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "eslint",
	version: "8.55.0",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:249fc81da9761b0f8710d0239ad09dcceea0c777d4933111496900a0ed2b3128";
	let owner = name;
	let repo = name;
	let tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		tag,
		version,
	});
});

export type Arg = {
	env?: std.env.Arg;
	host?: std.Triple.Arg;
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
