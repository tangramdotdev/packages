import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "diffutils",
	version: "3.8",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:a6bdd7d1b31266d11c4f4de6c1b748d4607ab0231af5188fc2533d0ae2438fec";
	return std.download.fromGnu({
		name,
		version,
		checksum,
		compressionFormat: "xz",
	});
});

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let diffutils = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = [],
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	return std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			sdk,
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
