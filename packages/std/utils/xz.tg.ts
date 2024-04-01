import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

export let metadata = {
	name: "xz",
	version: "5.4.6",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let unpackFormat = ".tar.gz" as const;
	let checksum =
		"sha256:aeba3e03bf8140ddedf62a0a367158340520f6b384f75ca6045ccc6c0d43fd5c";
	let url = `https://downloads.sourceforge.net/project/lzmautils/${name}-${version}${unpackFormat}`;
	let outer = tg.Directory.expect(
		await std.download({
			url,
			checksum,
			unpackFormat,
		}),
	);
	return std.directory.unwrap(outer);
});

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		bootstrapMode,
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let configure = {
		args: [
			"--disable-debug",
			"--disable-dependency-tracking",
			"--disable-nls",
			"--disable-silent-rules",
		],
	};

	let env: tg.Unresolved<std.env.Arg> = [env_];
	if (bootstrapMode) {
		env.push(prerequisites(host));
	}

	let output = await buildUtil(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			bootstrapMode,
			env,
			phases: { configure },
			source: source_ ?? source(),
			wrapBashScriptPaths: [
				"bin/xzdiff",
				"bin/xzgrep",
				"bin/xzless",
				"bin/xzmore",
			],
		},
		autotools,
	);

	let bins = ["lzmadec", "lzmainfo", "xz", "xzdec"];
	let libDir = tg.Directory.expect(await output.get("lib"));
	for (let bin of bins) {
		let unwrappedBin = tg.File.expect(await output.get(`bin/${bin}`));
		let wrappedBin = std.wrap({
			buildToolchain: bootstrapMode ? env_ : undefined,
			executable: unwrappedBin,
			libraryPaths: [libDir],
		});
		output = await tg.directory(output, { [`bin/${bin}`]: wrappedBin });
	}
	return output;
});

export default build;

export let test = tg.target(async () => {
	let host = bootstrap.toolchainTriple(await std.triple.host());
	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });
	let xzArtifact = build({ host, bootstrapMode, env: sdk });
	await std.assert.pkg({
		bootstrapMode,
		directory: xzArtifact,
		binaries: ["xz"],
		libs: ["lzma"],
		metadata,
	});
	return xzArtifact;
});
