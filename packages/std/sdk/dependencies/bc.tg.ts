import * as std from "../../tangram.tg.ts";
import make from "./make.tg.ts";

export let metadata = {
	name: "bc",
	version: "6.6.0",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let owner = "gavinhoward";
	let repo = name;
	let tag = version;
	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:309ef0faebf149376aa69446a496fac13c3ff483a100a51d9c67cea1a73b2906";
	return std.download.fromGithub({
		checksum,
		compressionFormat,
		owner,
		repo,
		tag,
		release: true,
		version,
	});
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

	let sourceDir = source_ ?? source();

	// Define phases
	let prepare = tg`cp -R ${sourceDir}/* . && chmod -R u+w .`;
	let configure = {
		command: "./configure",
		args: ["--disable-nls", "--disable-man-pages", "--opt=3"],
	};

	// Define environment.
	let ccCommand = build.os == "darwin" ? "cc -D_DARWIN_C_SOURCE" : "cc";
	let env = [std.utils.env(arg), make(arg), { CC: ccCommand }, env_];

	let output = std.utils.buildUtil(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			env,
			opt: "3",
			phases: { prepare, configure },
			source: sourceDir,
		},
		autotools,
	);

	return output;
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		directory: build({ sdk: { bootstrapMode: true } }),
		binaries: ["bc"],
		metadata,
	});
	return true;
});
