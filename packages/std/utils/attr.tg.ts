import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

export let metadata = {
	name: "attr",
	version: "2.5.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let unpackFormat = ".tar.xz" as const;
	let packageArchive = std.download.packageArchive({
		name,
		version,
		unpackFormat,
	});
	let checksum =
		"sha256:f2e97b0ab7ce293681ab701915766190d607a1dba7fae8a718138150b700a70b";
	let url = `https://mirrors.sarata.com/non-gnu/attr/${packageArchive}`;
	let outer = tg.Directory.expect(
		await std.download({ url, checksum, unpackFormat }),
	);
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
		bootstrapMode,
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
	if (bootstrapMode && usePrerequisites) {
		env.push(prerequisites(host));
	}
	if (staticBuild) {
		env.push({ CC: "gcc -static" });
	}

	let output = await buildUtil(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			bootstrapMode,
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
			buildToolchain: bootstrapMode ? env_ : undefined,
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
	let host = bootstrap.toolchainTriple(await std.triple.host());
	let bootstrapMode = true;
	let sdk = std.sdk({ bootstrapMode, host });
	let directory = build({ host, bootstrapMode, env: sdk });
	let binTest = (name: string) => {
		return {
			name,
			testArgs: [],
			testPredicate: (stdout: string) => stdout.includes("Usage:"),
		};
	};
	let binaries = ["attr", "getfattr", "setfattr"].map(binTest);

	await std.assert.pkg({
		bootstrapMode,
		binaries,
		directory,
		libs: ["attr"],
		metadata,
	});
	return directory;
});
