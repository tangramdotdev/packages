import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "m4",
	version: "1.4.19",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:3be4a26d825ffdfda52a56fc43246456989a3630093cced3fbddf4771ee58a70";
	return std.download.fromGnu({ name, version, checksum });
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let m4 = tg.target(async (arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	let configure = {
		args: ["--disable-dependency-tracking"],
	};

	return std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			phases: { configure },
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default m4;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: m4,
		binaries: ["m4"],
		metadata,
	});
	return true;
});
