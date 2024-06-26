import * as autoconf from "tg:autoconf" with { path: "../autoconf" };
import * as bison from "tg:bison" with { path: "../bison" };
import * as m4 from "tg:m4" with { path: "../m4" };
import * as perl from "tg:perl" with { path: "../perl" };
import * as std from "tg:std" with { path: "../std" };
import * as texinfo from "tg:texinfo" with { path: "../texinfo" };
import * as zlib from "tg:zlib" with { path: "../zlib" };

export let metadata = {
	homepage: "https://www.gnu.org/software/help2man/",
	license: "GPL-3.0-or-later",
	name: "help2man",
	repository: "https://git.savannah.gnu.org/git/help2man.git",
	version: "1.49.3",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:4d7e4fdef2eca6afe07a2682151cea78781e0a4e8f9622142d9f70c083a2fd4f";
	return std.download.fromGnu({
		name,
		version,
		compressionFormat: "xz",
		checksum,
	});
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		autoconf?: autoconf.Arg;
		bison?: bison.Arg;
		m4?: m4.Arg;
		perl?: perl.Arg;
		texinfo?: texinfo.Arg;
		zlib?: zlib.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		dependencies: {
			autoconf: autoconfArg = {},
			bison: bisonArg = {},
			m4: m4Arg = {},
			perl: perlArg = {},
			texinfo: texinfoArg = {},
			zlib: zlibArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let perlArtifact = await perl.build(perlArg);
	let interpreter = tg.symlink({
		artifact: perlArtifact,
		path: tg.Path.new("bin/perl"),
	});
	let dependencies = [
		autoconf.build(autoconfArg),
		bison.build(bisonArg),
		m4.build(m4Arg),
		perlArtifact,
		texinfo.build(texinfoArg),
		zlib.build(zlibArg),
	];
	let env = std.env.arg(...dependencies, env_);
	let artifact = std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	let wrappedScript = std.wrap(
		tg.symlink({ artifact, path: tg.Path.new("bin/help2man") }),
		{
			interpreter,
		},
	);

	return tg.directory({
		["bin/help2man"]: wrappedScript,
	});
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["help2man"],
		metadata,
	});
	return true;
});
