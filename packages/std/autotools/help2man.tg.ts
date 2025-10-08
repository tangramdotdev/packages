import * as std from "../tangram.ts";

export const metadata = {
	homepage: "https://www.gnu.org/software/help2man/",
	license: "GPL-3.0-or-later",
	name: "help2man",
	repository: "https://git.savannah.gnu.org/git/help2man.git",
	version: "1.49.3",
	tag: "help2man/1.49.3",
	provides: {
		binaries: ["help2man"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:4d7e4fdef2eca6afe07a2682151cea78781e0a4e8f9622142d9f70c083a2fd4f";
	return std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});
};

export type Arg = {
	bootstrap?: boolean;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	perlArtifact: tg.Directory;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (arg: tg.Unresolved<Arg>) => {
	const {
		bootstrap = false,
		build,
		env: env_,
		host,
		perlArtifact,
		sdk,
		source: source_,
	} = await tg.resolve(arg);

	const interpreter = tg.symlink({
		artifact: perlArtifact,
		path: "bin/perl",
	});
	const env = std.env.arg(env_, { utils: false });
	const artifact = std.autotools.build({
		...(await std.triple.rotate({ build, host })),
		bootstrap,
		env,
		sdk,
		source: source_ ?? source(),
	});

	const wrappedScript = std.wrap(
		tg.symlink({ artifact, path: "bin/help2man" }),
		{
			interpreter,
			buildToolchain: env,
		},
	);

	return tg.directory({
		["bin/help2man"]: wrappedScript,
	});
};

export default build;
