import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

export let metadata = {
	name: "attr",
	version: "2.5.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let extension = ".tar.xz";
	let packageArchive = std.download.packageArchive({
		extension,
		name,
		version,
	});
	let checksum =
		"sha256:f2e97b0ab7ce293681ab701915766190d607a1dba7fae8a718138150b700a70b";
	let url = `https://mirrors.sarata.com/non-gnu/attr/${packageArchive}`;
	let outer = tg.Directory.expect(await std.download({ url, checksum }));
	return await std.directory.unwrap(outer);
});

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
	staticBuild?: boolean;
	usePrerequisites?: boolean;
};

export let build = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		staticBuild = false,
		usePrerequisites = true,
		...rest
	} = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	if (std.triple.os(host) !== "linux" || std.triple.os(build) !== "linux") {
		throw new Error(
			`Unsupported system: ${host}. The attr package is Linux-only.`,
		);
	}

	let configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-nls",
			"--disable-rpath",
			"--with-pic",
		],
	};
	if (staticBuild) {
		configure.args.push("--enable-static");
		configure.args.push("--disable-shared");
	}

	let phases = { configure };

	let env: tg.Unresolved<Array<std.env.Arg>> = [env_];
	if (usePrerequisites) {
		env.push(prerequisites(host));
	}
	if (staticBuild) {
		env.push({ CC: "gcc -static" });
	}

	let output = await buildUtil(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases,
			opt: staticBuild ? "s" : undefined,
			source: source_ ?? source(),
		},
		autotools,
	);

	let bins = ["attr", "getfattr", "setfattr"];
	for (let bin of bins) {
		let unwrappedBin = tg.File.expect(await output.get(`bin/${bin}`));
		let wrappedBin = std.wrap({
			buildToolchain: bootstrap.sdk(),
			executable: unwrappedBin,
			libraryPaths: [tg.symlink(tg`${output}/lib`)],
		});
		output = await tg.directory(output, { [`bin/${bin}`]: wrappedBin });
	}
	return output;
});

export default build;

import * as bootstrap from "../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdkArg = await bootstrap.sdk.arg(host);
	let binTest = (name: string) => {
		return {
			name,
			testArgs: [],
			testPredicate: (stdout: string) => stdout.includes("Usage:"),
		};
	};
	let binaries = ["attr", "getfattr", "setfattr"].map(binTest);

	await std.assert.pkg({
		binaries,
		buildFunction: build,
		libraries: ["attr"],
		metadata,
		sdk: sdkArg,
	});
	return true;
});
