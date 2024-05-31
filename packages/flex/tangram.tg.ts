import * as help2man from "tg:help2man" with { path: "../help2man" };
import * as m4 from "tg:m4" with { path: "../m4" };
import * as std from "tg:std" with { path: "../std" };
import * as texinfo from "tg:texinfo" with { path: "../texinfo" };

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

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		help2man?: help2man.Arg;
		m4?: m4.Arg;
		texinfo?: texinfo.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let flex = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		dependencies: {
			help2man: help2manArg = {},
			m4: m4Arg = {},
			texinfo: texinfoArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let dependencies = [
		help2man.help2man(help2manArg),
		m4.m4(m4Arg),
		texinfo.texinfo(texinfoArg),
	];
	let env = std.env.arg(...dependencies, env_);

	return std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			env,
			sdk,
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
