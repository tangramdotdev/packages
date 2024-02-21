import * as std from "../tangram.tg.ts";
import { buildUtil, prerequisites } from "../utils.tg.ts";

export let metadata = {
	name: "attr",
	version: "2.5.1",
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
		"sha256:db448a626f9313a1a970d636767316a8da32aede70518b8050fa0de7947adc32";
	let url = `https://mirrors.sarata.com/non-gnu/attr/${packageArchive}`;
	let outer = tg.Directory.expect(
		await std.download({ url, checksum, unpackFormat }),
	);
	return await std.directory.unwrap(outer);
});

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
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
		usePrerequisites = true,
		...rest
	} = arg ?? {};

	let host = host_ ? tg.triple(host_) : await tg.Triple.host();
	let build = build_ ? tg.triple(build_) : host;

	if (host.os !== "linux") {
		let hostString = tg.Triple.toString(host);
		throw new Error(
			`Unsupported system: ${hostString}. The attr package is Linux-only.`,
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

	let phases = { configure };

	let env: tg.Unresolved<Array<std.env.Arg>> = [];
	if (bootstrapMode && usePrerequisites) {
		env.push(prerequisites({ host }));
	}
	env.push(env_);

	let output = await buildUtil(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			bootstrapMode,
			env,
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);

	let bins = ["attr", "getfattr", "setfattr"];
	for (let bin of bins) {
		let unwrappedBin = tg.File.expect(await output.get(`bin/${bin}`));
		let wrappedBin = std.wrap(unwrappedBin, {
			libraryPaths: [tg.symlink(tg`${output}/lib`)],
			sdk: arg?.sdk,
		});
		output = await tg.directory(output, { [`bin/${bin}`]: wrappedBin });
	}
	return output;
});

export default build;

import * as bootstrap from "../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = bootstrap.toolchainTriple(await tg.Triple.host());
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
		binaries,
		directory,
		libs: ["attr"],
		metadata,
	});
	return directory;
});
