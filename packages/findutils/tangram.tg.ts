import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };

export let metadata = {
	name: "findutils",
	version: "4.9.0",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:a2bfb8c09d436770edc59f50fa483e785b161a3b7b9d547573cb08065fd462fe";
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
		autotools = [],
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

export let test = tg.target(async () => {
	return await $`
			echo "Checking that we can run findutils." | tee $OUTPUT
			find --version | tee -a $OUTPUT
			locate --version | tee -a $OUTPUT
			updatedb --version | tee -a $OUTPUT
			xargs --version | tee -a $OUTPUT
		`.env(build());
});
