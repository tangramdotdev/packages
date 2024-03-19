import bison from "tg:bison" with { path: "../bison" };
import libseccomp from "tg:libseccomp" with { path: "../libseccomp" };
import m4 from "tg:m4" with { path: "../m4" };
import * as std from "tg:std" with { path: "../std" };
import zlib from "tg:zlib" with { path: "../zlib" };

export let metadata = {
	homepage: "https://www.darwinsys.com/file/",
	license: "https://github.com/file/file/blob/FILE5_45/COPYING",
	name: "file",
	repository: "https://github.com/file/file",
	version: "5.45",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let unpackFormat = ".tar.gz" as const;
	let packageArchive = std.download.packageArchive({
		name,
		version,
		unpackFormat,
	});
	let checksum =
		"sha256:fc97f51029bb0e2c9f4e3bffefdaf678f0e039ee872b9de5c002a6d09c784d82";
	let url = `https://astron.com/pub/file/${packageArchive}`;
	let outer = tg.Directory.expect(
		await std.download({ url, checksum, unpackFormat }),
	);
	return await std.directory.unwrap(outer);
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: tg.Triple.Arg;
	env?: std.env.Arg;
	host?: tg.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let file = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = await tg.Triple.host(host_);
	let build = build_ ? tg.triple(build_) : host;

	let configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-silent-rules",
		],
	};
	let dependencies = [bison(arg), libseccomp(arg), m4(arg), zlib(arg)];
	let env = [...dependencies, env_];

	let output = await std.autotools.build(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			env,
			hardeningCFlags: false,
			phases: { configure },
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
		sdk: arg?.sdk,
	});
	return tg.directory(output, {
		"bin/file": wrappedFile,
	});
});

export default file;

export let test = tg.target(async () => {
	let directory = file();
	await std.assert.pkg({
		directory,
		binaries: ["file"],
		metadata,
	});
	return directory;
});
