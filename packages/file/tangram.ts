import * as bison from "bison" with { path: "../bison" };
import * as libseccomp from "libseccomp" with { path: "../libseccomp" };
import * as m4 from "m4" with { path: "../m4" };
import * as std from "std" with { path: "../std" };
import * as zlib from "zlib" with { path: "../zlib" };

export const metadata = {
	homepage: "https://www.darwinsys.com/file/",
	license: "https://github.com/file/file/blob/FILE5_45/COPYING",
	name: "file",
	repository: "https://github.com/file/file",
	version: "5.45",
	provides: {
		binaries: ["file"],
		headers: ["magic.h"],
		libraries: [{ name: "magic", staticlib: false, dylib: true }],
	},
};

export const source = tg.command(async () => {
	const { name, version } = metadata;
	const extension = ".tar.gz";
	const checksum =
		"sha256:fc97f51029bb0e2c9f4e3bffefdaf678f0e039ee872b9de5c002a6d09c784d82";
	const base = `https://astron.com/pub/${name}`;
	return await std
		.download({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		bison?: std.args.DependencyArg<bison.Arg>;
		libseccomp?: std.args.DependencyArg<libseccomp.Arg>;
		m4?: std.args.DependencyArg<m4.Arg>;
		zlib?: std.args.DependencyArg<zlib.Arg>;
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
		dependencies: dependencyArgs = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(args);

	const configure = {
		args: ["--disable-dependency-tracking", "--disable-silent-rules"],
	};
	const dependencies = [
		std.env.buildDependency(bison.build, dependencyArgs.bison),
		std.env.buildDependency(m4.build, dependencyArgs.m4),
		std.env.runtimeDependency(zlib.build, dependencyArgs.zlib),
	];
	if (std.triple.os(host) === "linux") {
		dependencies.push(
			std.env.runtimeDependency(libseccomp.build, dependencyArgs.libseccomp),
		);
	}
	const env = std.env.arg(
		...dependencies.map((dep) =>
			std.env.envArgFromDependency(build, env_, host, sdk, dep),
		),
		env_,
	);

	const output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(env),
			hardeningCFlags: false,
			phases: { configure },
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	// Always set MAGIC when using `file`.
	const magic = tg.directory({
		"magic.mgc": tg.File.expect(await output.get("share/misc/magic.mgc")),
	});
	const rawFile = tg.File.expect(await output.get("bin/file"));
	const wrappedFile = std.wrap(rawFile, {
		env: {
			MAGIC: tg.Mutation.setIfUnset(tg`${magic}/magic.mgc`),
		},
		libraryPaths: [tg.Directory.expect(await output.get("lib"))],
	});
	return tg.directory(output, {
		"bin/file": wrappedFile,
	});
});

export default build;

export const run = tg.command(async (...args: Array<tg.Value>) => {
	const dir = await build.build();
	return await tg.run({ executable: tg.symlink(tg`${dir}/bin/file`), args });
});

export const test = tg.command(async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
});
