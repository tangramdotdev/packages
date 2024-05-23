import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

export let metadata = {
	name: "bzip2",
	version: "1.0.8",
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
		"sha256:ab5a03176ee106d3f0fa90e381da478ddae405918153cca248e682cd0c4a2269";
	let url = `https://sourceware.org/pub/bzip2/${packageArchive}`;
	return await std
		.download({ url, checksum })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;
	let os = std.triple.os(host);
	let sourceDir = source_ ?? source();

	// Define phases.
	let buildPhase =
		os === "darwin"
			? `make CC="$CC" SHELL="$SHELL"`
			: `make CC="$CC" SHELL="$SHELL" -f Makefile-libbz2_so && make CC="$CC" SHELL="$SHELL"`;
	let install =
		os === "darwin"
			? {
					command: `make install PREFIX="$OUTPUT" SHELL="$SHELL"`,
					args: tg.Mutation.unset(),
			  }
			: {
					command: `make install PREFIX="$OUTPUT" SHELL="$SHELL" && cp libbz2.so.* $OUTPUT/lib`,
					args: tg.Mutation.unset(),
			  };
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
	`;
	if (os === "linux") {
		fixup += `\nln -s libbz2.so.1.0 libbz2.so`;
	}
	let phases = {
		configure: tg.Mutation.unset(),
		build: buildPhase,
		install,
		fixup,
	};

	let env = std.env.arg(env_, prerequisites(host));

	let output = buildUtil({
		...std.triple.rotate({ build, host }),
		buildInTree: true,
		env,
		phases,
		sdk,
		source: sourceDir,
		wrapBashScriptPaths: ["bin/bzdiff", "bin/bzgrep", "bin/bzmore"],
	});
	return output;
});

export default build;

export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdk = await bootstrap.sdk.arg(host);
	let os = std.triple.os(host);

	await std.assert.pkg({
		buildFunction: build,
		binaries: [{ name: "bzip2", testArgs: ["--help"] }],
		libraries:
			os === "darwin"
				? [{ name: "bz2", dylib: false, staticlib: true }]
				: ["bz2"],
		metadata,
		sdk,
	});
	return true;
});
