import * as autoconf from "autoconf" with { path: "../autoconf" };
import * as bison from "bison" with { path: "../bison" };
import * as m4 from "m4" with { path: "../m4" };
import * as perl from "perl" with { path: "../perl" };
import * as std from "std" with { path: "../std" };
import * as texinfo from "texinfo" with { path: "../texinfo" };
import * as zlib from "zlib" with { path: "../zlib" };

export const metadata = {
	homepage: "https://www.gnu.org/software/help2man/",
	license: "GPL-3.0-or-later",
	name: "help2man",
	repository: "https://git.savannah.gnu.org/git/help2man.git",
	version: "1.49.3",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
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

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
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

	const perlArtifact = await perl.build({ build, host: build }, perlArg);
	const interpreter = tg.symlink({
		artifact: perlArtifact,
		subpath: "bin/perl",
	});
	const dependencies = [
		autoconf.build({ build, env: env_, host, sdk }, autoconfArg),
		bison.build({ build, host: build }, bisonArg),
		m4.build({ build, host: build }, m4Arg),
		perlArtifact,
		texinfo.build({ build, host: build }, texinfoArg),
		zlib.build({ build, env: env_, host, sdk }, zlibArg),
	];
	const env = std.env.arg(...dependencies, env_);
	const artifact = std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	const wrappedScript = std.wrap(
		tg.symlink({ artifact, subpath: "bin/help2man" }),
		{
			interpreter,
		},
	);

	return tg.directory({
		["bin/help2man"]: wrappedScript,
	});
});

export default build;

export const provides = {
	binaries: ["help2man"],
};

export const test = tg.target(async () => {
	const spec = std.assert.defaultSpec(provides, metadata);
	return await std.assert.pkg(build, spec);
});
