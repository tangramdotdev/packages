import * as std from "../../tangram.tg.ts";
// FIXME - try without these?
import bison from "./bison.tg.ts";
import m4 from "./m4.tg.ts";
import make from "./make.tg.ts";
import zlib from "./zlib.tg.ts";

export let metadata = {
	name: "file",
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

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = await std.Triple.host(host_);
	let build = build_ ? std.triple(build_) : host;

	let configure = {
		args: [
			"--disable-bzlib",
			"--disable-dependency-tracking",
			"--disable-libseccomp",
			"--disable-silent-rules",
			"--disable-xzlib",
			"--disable-zlib",
			"--enable-static",
		],
	};
	let dependencies = [bison(arg), m4(arg), make(arg), zlib(arg)];
	let env = [std.utils.env(arg), ...dependencies, env_];

	let output = await std.utils.buildUtil(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			env,
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

export default build;

export let test = tg.target(async () => {
	// TODO - test magic file wrapping.
	await std.assert.pkg({
		directory: build({ sdk: { bootstrapMode: true } }),
		binaries: ["file"],
		metadata,
	});
	return true;
});
