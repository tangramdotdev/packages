import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };

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
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let configure = {
		args: ["--disable-dependency-tracking"],
	};
	let phases = { configure };

	return std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			env,
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export let test = tg.target(async () => {
	return await $`
		mkdir -p $OUTPUT
		echo "Checking that we can run gnu hello."
		${build()}/bin/hello
	`;
});
