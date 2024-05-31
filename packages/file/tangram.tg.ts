import * as bison from "tg:bison" with { path: "../bison" };
import * as libseccomp from "tg:libseccomp" with { path: "../libseccomp" };
import * as m4 from "tg:m4" with { path: "../m4" };
import * as std from "tg:std" with { path: "../std" };
import * as zlib from "tg:zlib" with { path: "../zlib" };

export let metadata = {
	homepage: "https://www.darwinsys.com/file/",
	license: "https://github.com/file/file/blob/FILE5_45/COPYING",
	name: "file",
	repository: "https://github.com/file/file",
	version: "5.45",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let extension = ".tar.gz";
	let packageArchive = std.download.packageArchive({
		extension,
		name,
		version,
	});
	let checksum =
		"sha256:fc97f51029bb0e2c9f4e3bffefdaf678f0e039ee872b9de5c002a6d09c784d82";
	let url = `https://astron.com/pub/file/${packageArchive}`;
	return await std
		.download({ url, checksum })
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

export let file = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build: build_,
		dependencies: {
			bison: bisonArg = {},
			libseccomp: libseccompArg = {},
			m4: m4Arg = {},
			zlib: zlibArg = {},
		} = {},
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(args);
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let configure = {
		args: ["--disable-dependency-tracking", "--disable-silent-rules"],
	};
	let dependencies = [
		bison.bison(bisonArg),
		libseccomp.libseccomp(libseccompArg),
		m4.m4(m4Arg),
		zlib.zlib(zlibArg),
	];
	let env = [...dependencies, env_];

	let output = await std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			env: std.env.arg(env),
			hardeningCFlags: false,
			phases: { configure },
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	// Always set MAGIC when using `file`.
	let magic = tg.directory({
		"magic.mgc": tg.File.expect(await output.get("share/misc/magic.mgc")),
	});
	let rawFile = tg.File.expect(await output.get("bin/file"));
	let wrappedFile = std.wrap(rawFile, {
		env: {
			MAGIC: tg.Mutation.setIfUnset(tg`${magic}/magic.mgc`),
		},
		libraryPaths: [tg.Directory.expect(await output.get("lib"))],
	});
	return tg.directory(output, {
		"bin/file": wrappedFile,
	});
});

export default file;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: file,
		binaries: ["file"],
		metadata,
	});
	return true;
});
