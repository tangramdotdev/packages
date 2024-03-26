import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "diffutils",
	version: "3.8",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:a6bdd7d1b31266d11c4f4de6c1b748d4607ab0231af5188fc2533d0ae2438fec";
	let compressionFormat = ".xz" as const;
	return std.download.fromGnu({ name, version, checksum, compressionFormat });
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let diffutils = tg.target(async (arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	return std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default diffutils;

export let test = tg.target(() => {
	return std.build(
		`
			echo "Checking that we can run diffutils." | tee $OUTPUT
			diff --version | tee -a $OUTPUT
			diff3 --version | tee -a $OUTPUT
			cmp --version | tee -a $OUTPUT
		`,
		{ env: diffutils() },
	);
});
