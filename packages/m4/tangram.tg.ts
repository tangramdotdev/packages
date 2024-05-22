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

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
	autotools?: std.autotools.Arg;
};

export let m4 = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = [],
		build,
		host,
		source: source_,
		...rest
	} = await arg(...(args ?? []));

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

export let arg = tg.target(async (...args: std.Args<Arg>) => {
	return await std.args.apply<Arg>(args);
});

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: m4,
		binaries: ["m4"],
		metadata,
	});
	return true;
});
