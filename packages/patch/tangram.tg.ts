import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://savannah.gnu.org/projects/patch/",
	license: "GPL-3.0-or-later",
	name: "patch",
	repository: "https://git.savannah.gnu.org/cgit/patch.git",
	version: "2.7.6",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:8cf86e00ad3aaa6d26aca30640e86b0e3e1f395ed99f189b06d4c9f74bc58a4e";
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
		echo "Checking that we can run patch."
		${build()}/bin/patch --version
	`;
});
