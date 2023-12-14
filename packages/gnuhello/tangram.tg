import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "hello",
	version: "2.12.1",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:8d99142afd92576f30b0cd7cb42a8dc6809998bc5d607d88761f512e26c7db20";
	return std.download.fromGnu({ name, version, checksum });
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: std.Triple.Arg;
	env?: std.env.Arg;
	host?: std.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let hello = tg.target(async (arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	let configure = {
		args: ["--disable-dependency-tracking"],
	};
	let phases = { configure };

	return std.autotools.build(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			source: source_ ?? source(),
			phases,
		},
		autotools,
	);
});

export default hello;

export let test = tg.target(() => {
	return std.build(tg`
		mkdir -p $OUTPUT
		echo "Checking that we can run gnu hello."
		${hello()}/bin/hello
	`);
});
