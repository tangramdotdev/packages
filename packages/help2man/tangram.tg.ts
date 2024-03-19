import autoconf from "tg:autoconf" with { path: "../autoconf" };
import bison from "tg:bison" with { path: "../bison" };
import gettext from "tg:gettext" with { path: "../gettext" };
import m4 from "tg:m4" with { path: "../m4" };
import perl from "tg:perl" with { path: "../perl" };
import * as std from "tg:std" with { path: "../std" };
import texinfo from "tg:texinfo" with { path: "../texinfo" };
import zlib from "tg:zlib" with { path: "../zlib" };

export let metadata = {
	homepage: "https://www.gnu.org/software/help2man/",
	license: "GPL-3.0-or-later",
	name: "help2man",
	repository: "https://git.savannah.gnu.org/git/help2man.git",
	version: "1.49.3",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:4d7e4fdef2eca6afe07a2682151cea78781e0a4e8f9622142d9f70c083a2fd4f";
	return std.download.fromGnu({ name, version, compressionFormat, checksum });
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: tg.Triple.Arg;
	env?: std.env.Arg;
	host?: tg.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let perlArtifact = await perl(arg);
	let interpreter = tg.symlink({ artifact: perlArtifact, path: "bin/perl" });
	let dependencies = [
		autoconf(arg),
		bison(arg),
		gettext(arg),
		m4(arg),
		perlArtifact,
		texinfo(arg),
		zlib(arg),
	];
	let env = [...dependencies, env_];
	let artifact = std.autotools.build(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			env,
			source: source_ ?? source(),
		},
		autotools,
	);

	let wrappedScript = std.wrap(tg.symlink({ artifact, path: "bin/help2man" }), {
		interpreter,
	});

	return tg.directory({
		["bin/help2man"]: wrappedScript,
	});
});

export default build;

export let test = tg.target(async () => {
	let directory = build();
	await std.assert.pkg({
		directory,
		binaries: ["help2man"],
		metadata,
	});
	return directory;
});
