import * as std from "../tangram.ts";

export const metadata = {
	homepage: "https://www.gnu.org/software/help2man/",
	license: "GPL-3.0-or-later",
	name: "help2man",
	repository: "https://git.savannah.gnu.org/git/help2man.git",
	version: "1.49.3",
	provides: {
		binaries: ["help2man"],
	},
};

export const source = tg.command(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:4d7e4fdef2eca6afe07a2682151cea78781e0a4e8f9622142d9f70c083a2fd4f";
	return std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});
});

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	perlArtifact: tg.Directory;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export const build = tg.command(async (arg: Arg) => {
	const { build, env: env_, host, perlArtifact, sdk, source: source_ } = arg;

	const interpreter = tg.symlink({
		artifact: perlArtifact,
		subpath: "bin/perl",
	});
	const env = std.env.arg(env_);
	const artifact = std.autotools.build({
		...(await std.triple.rotate({ build, host })),
		env,
		sdk,
		source: source_ ?? source(),
	});

	const wrappedScript = std.wrap(
		tg.symlink({ artifact, subpath: "bin/help2man" }),
		{
			interpreter,
			buildToolchain: env,
		},
	);

	return tg.directory({
		["bin/help2man"]: wrappedScript,
	});
});

export default build;
