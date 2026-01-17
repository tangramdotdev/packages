import * as autoconf from "autoconf" with { local: "./autoconf.tg.ts" };
import * as perl from "perl" with { local: "./perl" };
import * as std from "std" with { local: "./std" };
import * as texinfo from "texinfo" with { local: "./texinfo.tg.ts" };
import * as zlib from "zlib-ng" with { local: "./zlib-ng.tg.ts" };

export const deps = () =>
	std.deps({
		autoconf: autoconf.build,
		perl: { build: perl.build, kind: "buildtime" },
		zlib: zlib.build,
	});

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

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = async (...args: std.Args<Arg>) => {
	// Get build triple first for texinfo (buildtime only).
	const options = await std.args.apply<Arg, Arg>({
		args: args as std.Args<Arg>,
		map: async (arg) => arg,
		reduce: {},
	});
	const build_ = options.build ?? options.host ?? std.triple.host();

	const arg = await std.autotools.arg(
		{
			source: source(),
			deps,
			// texinfo returns an env file, not a directory, so add it manually.
			env: texinfo.build({ build: build_, host: build_ }),
		},
		...args,
	);

	const { perl: perlArtifact } = await std.deps.artifacts(deps, {
		build: arg.build,
		host: arg.host,
	});
	tg.assert(perlArtifact !== undefined);

	const interpreter = tg.symlink({
		artifact: perlArtifact,
		path: "bin/perl",
	});

	const artifact = await std.autotools.build(arg);

	const wrappedScript = std.wrap(
		tg.symlink({ artifact, path: "bin/help2man" }),
		{
			interpreter,
		},
	);

	return tg.directory({
		["bin/help2man"]: wrappedScript,
	});
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
