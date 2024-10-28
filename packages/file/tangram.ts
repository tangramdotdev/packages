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
};

export const source = tg.target(async () => {
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
		bison?: bison.Arg;
		libseccomp?: libseccomp.Arg;
		m4?: m4.Arg;
		zlib?: zlib.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: {
			bison: bisonArg = {},
			libseccomp: libseccompArg = {},
			m4: m4Arg = {},
			zlib: zlibArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(args);

	const configure = {
		args: ["--disable-dependency-tracking", "--disable-silent-rules"],
	};
	const dependencies = [
		bison.default_({ build, host: build }, bisonArg),
		m4.default_({ build, host: build }, m4Arg),
		zlib.default_({ build, env: env_, host, sdk }, zlibArg),
	];
	if (std.triple.os(host) === "linux") {
		dependencies.push(
			libseccomp.default_({ build, env: env_, host, sdk }, libseccompArg),
		);
	}
	const env = [...dependencies, env_];

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

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({
		packageDir: default_(),
		binaries: ["file"],
		metadata,
	});
	return true;
});
