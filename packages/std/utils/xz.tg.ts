import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

export let metadata = {
	name: "xz",
	version: "5.4.6",
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
		"sha256:aeba3e03bf8140ddedf62a0a367158340520f6b384f75ca6045ccc6c0d43fd5c";
	let url = `https://downloads.sourceforge.net/project/lzmautils/${packageArchive}`;
	let outer = tg.Directory.expect(await std.download({ url, checksum }));
	return std.directory.unwrap(outer);
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

	let env = [env_, prerequisites(host)];

	let output = await buildUtil(
		{
			...rest,
			...std.triple.rotate({ build, host }),
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
	console.log("pre-wrap xz", await output.id());

	let bins = ["lzmadec", "lzmainfo", "xz", "xzdec"];
	let libDir = tg.Directory.expect(await output.get("lib"));
	console.log("libDir", await libDir.id());
	for (let bin of bins) {
		console.log("wrapping", bin);
		let unwrappedBin = tg.File.expect(await output.get(`bin/${bin}`));
		console.log("unwrappedBin", await unwrappedBin.id());
		let wrappedBin = std.wrap({
			buildToolchain: bootstrap.sdk.env(host),
			executable: unwrappedBin,
			libraryPaths: [libDir],
		});
		console.log("wrappedBin", await (await wrappedBin).id());
		output = await tg.directory(output, { [`bin/${bin}`]: wrappedBin });
	}
	console.log("post-wrap xz", await output.id());

	return output;
});

export default build;

export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdkArg = await bootstrap.sdk.arg(host);
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["xz"],
		libraries: ["lzma"],
		metadata,
		sdk: sdkArg,
	});
	return true;
});
