import * as std from "../../tangram.tg.ts";
import bison from "./bison.tg.ts";
import m4 from "./m4.tg.ts";
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
	let host = await tg.Triple.host(host_);
	let build = build_ ? tg.triple(build_) : host;

	let configure = {
		args: [
			"--disable-bzlib",
			"--disable-dependency-tracking",
			"--disable-libseccomp",
			"--disable-silent-rules",
			"--disable-xzlib",
			"--disable-zlib",
		],
	};
	let dependencies = [bison(arg), m4(arg), zlib(arg)];
	let env = [env_, std.utils.env(arg), ...dependencies];

	let output = await std.utils.buildUtil(
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
	let wrappedFile = std.wrap({
		buildToolchain: env_,
		executable: rawFile,
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

import * as bootstrap from "../../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = bootstrap.toolchainTriple(await tg.Triple.host());
	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });
	let directory = build({ host, bootstrapMode, env: sdk });
	await std.assert.pkg({
		directory,
		binaries: ["file"],
		metadata,
	});
	return directory;
});
