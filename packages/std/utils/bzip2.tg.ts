import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

export let metadata = {
	name: "bzip2",
	version: "1.0.8",
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
		"sha256:ab5a03176ee106d3f0fa90e381da478ddae405918153cca248e682cd0c4a2269";
	let url = `https://sourceware.org/pub/bzip2/${packageArchive}`;
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
		bootstrapMode,
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let sourceDir = source_ ?? source();

	// Define phases.
	let buildPhase = `make -f Makefile-libbz2_so && make`;
	let install = tg.Mutation.set(
		`make install PREFIX=$OUTPUT && cp libbz2.so.* $OUTPUT/lib`,
	);
	// NOTE - these symlinks get installed with absolute paths pointing to the ephermeral output directory. Use relative links instead.
	let fixup = `
		cd $OUTPUT/bin
		rm bzcmp
		ln -s bzdiff bzcmp
		rm bzegrep bzfgrep
		ln -s bzgrep bzegrep
		ln -s bzgrep bzfgrep
		rm bzless
		ln -s bzmore bzless
		cd $OUTPUT/lib
		ln -s libbz2.so.1.0 libbz2.so
	`;
	let phases = {
		configure: tg.Mutation.unset(),
		build: buildPhase,
		install,
		fixup,
	};

	let env: tg.Unresolved<Array<std.env.Arg>> = [env_];
	if (bootstrapMode) {
		env.push(prerequisites({ host }));
	}

	let output = buildUtil(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			bootstrapMode,
			buildInTree: true,
			env,
			phases,
			source: sourceDir,
			wrapBashScriptPaths: ["bin/bzdiff", "bin/bzgrep", "bin/bzmore"],
		},
		autotools,
	);
	return output;
});

export default build;

export let test = tg.target(async () => {
	let host = bootstrap.toolchainTriple(await tg.Triple.host());
	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });
	let directory = build({ host, bootstrapMode, env: sdk });
	await std.assert.pkg({
		directory,
		binaries: [{ name: "bzip2", testArgs: ["--help"] }],
		libs: ["bz2"],
		metadata,
	});
	return directory;
});
