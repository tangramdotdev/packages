import * as std from "../../tangram.tg.ts";
import make from "./make.tg.ts";

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
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let sourceDir = source_ ?? source();

	// Define phases.
	let prepare = tg`set -x && cp -R ${sourceDir}/* .`;
	let install = `make install PREFIX=$OUTPUT`;
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
	`;
	let phases = {
		prepare,
		configure: tg.Mutation.unset(),
		install,
		fixup,
	};

	let env = [std.utils.env(arg), make(arg), env_];

	let output = std.utils.buildUtil(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
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
	await std.assert.pkg({
		directory: build({ sdk: { bootstrapMode: true } }),
		binaries: [{ name: "bzip2", testArgs: ["--help"] }],
		libs: [{ name: "bz2", dylib: false, staticlib: true }],
		metadata,
	});
	return true;
});
