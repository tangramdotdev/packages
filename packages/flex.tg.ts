import * as help2man from "help2man" with { local: "./help2man.tg.ts" };
import * as std from "std" with { local: "./std" };
import * as texinfo from "texinfo" with { local: "./texinfo.tg.ts" };

export const metadata = {
	homepage: "https://github.com/westes/flex",
	license: "https://github.com/westes/flex/tree/master?tab=License-1-ov-file",
	name: "flex",
	repository: "https://github.com/westes/flex",
	version: "2.6.4",
	tag: "flex/2.6.4",
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

const deps = await std.deps({
	help2man: { build: help2man.build, kind: "buildtime" },
});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg({ source: source(), deps }, ...args);
	// texinfo.build returns a file, not a directory, so add it to env directly.
	const texinfoEnv = texinfo.build({
		build: arg.build,
		host: arg.build,
	});
	return std.autotools.build({
		...arg,
		env: std.env.arg(arg.env, texinfoEnv),
	});
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
