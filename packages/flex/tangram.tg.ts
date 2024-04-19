import help2man from "tg:help2man" with { path: "../help2man" };
import m4 from "tg:m4" with { path: "../m4" };
import * as std from "tg:std" with { path: "../std" };
import texinfo from "tg:texinfo" with { path: "../texinfo" };

export let metadata = {
	homepage: "https://github.com/westes/flex",
	license: "https://github.com/westes/flex/tree/master?tab=License-1-ov-file",
	name: "flex",
	repository: "https://github.com/westes/flex",
	version: "2.6.4",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:e87aae032bf07c26f85ac0ed3250998c37621d95f8bd748b31f15b33c45ee995";
	let owner = "westes";
	let repo = name;
	let tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "release",
		tag,
		version,
	});
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let flex = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let dependencies = [help2man(arg), m4(arg), texinfo(arg)];
	let env = [...dependencies, env_];

	return std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default flex;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: flex,
		binaries: ["flex"],
		metadata,
	});
	return true;
});
