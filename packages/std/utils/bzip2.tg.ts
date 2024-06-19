import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";
import dylibDetectOsPatch from "./bzip2_dylib_detect_os.patch" with {
	type: "file",
};

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
	let source = await std
		.download({ url, checksum })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
	return bootstrap.patch(source, dylibDetectOsPatch);
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
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
	let sourceDir = source_ ?? source();

	// Define phases.
	let buildPhase = `make CC="$CC" SHELL="$SHELL" -f Makefile-libbz2_so && make CC="$CC" SHELL="$SHELL"`;
	let install = {
		args: [`PREFIX="$OUTPUT" SHELL="$SHELL"`],
	};
	let phases = {
		configure: tg.Mutation.unset(),
		build: buildPhase,
		install,
	};

	let env = std.env.arg(env_, prerequisites(host));

	return await buildUtil({
		...std.triple.rotate({ build, host }),
		buildInTree: true,
		env,
		phases,
		sdk,
		source: sourceDir,
		wrapBashScriptPaths: ["bin/bzdiff", "bin/bzgrep", "bin/bzmore"],
	});
});

export default build;

export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdk = await bootstrap.sdk.arg(host);
	return build({ host, sdk });
});
