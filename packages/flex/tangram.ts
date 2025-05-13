import * as help2man from "help2man" with { path: "../help2man" };
import * as std from "std" with { path: "../std" };
import * as texinfo from "texinfo" with { path: "../texinfo" };

export const metadata = {
	homepage: "https://github.com/westes/flex",
	license: "https://github.com/westes/flex/tree/master?tab=License-1-ov-file",
	name: "flex",
	repository: "https://github.com/westes/flex",
	version: "2.6.4",
	provides: {
		binaries: ["flex"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:e87aae032bf07c26f85ac0ed3250998c37621d95f8bd748b31f15b33c45ee995";
	const owner = "westes";
	const repo = name;
	const tag = `v${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "release",
		tag,
		version,
	});
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		help2man?: help2man.Arg;
		texinfo?: texinfo.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: { help2man: help2manArg = {}, texinfo: texinfoArg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const dependencies = [
		help2man.build({ build, env: env_, host, sdk }, help2manArg),
		texinfo.build({ build, env: env_, host, sdk }, texinfoArg),
	];
	const env = std.env.arg(...dependencies, env_);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
