import * as autoconf from "autoconf" with { path: "../autoconf" };
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
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		autoconf?: autoconf.Arg;
		perl?: perl.Arg;
		texinfo?: texinfo.Arg;
		zlib?: zlib.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.command(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: {
			autoconf: autoconfArg = {},
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

export const run = tg.command(async (...args: Array<tg.Value>) => {
	const dir = await build.build();
	return await tg.run({
		executable: tg.symlink(tg`${dir}/bin/help2man`),
		args,
	});
});

export const test = tg.command(async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
});
