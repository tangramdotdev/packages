import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };

export let metadata = {
	name: "sed",
	version: "4.8",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:53cf3e14c71f3a149f29d13a0da64120b3c1d3334fba39c4af3e520be053982a";
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

export default build;

export let test = tg.target(async () => {
	return await $`
		echo "Checking that we can run sed."
		${build()}/bin/sed --version
	`;
});
