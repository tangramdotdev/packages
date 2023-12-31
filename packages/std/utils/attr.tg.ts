import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";
import { buildUtil } from "../utils.tg.ts";

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
};

export let build = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};

	let host = await std.Triple.host(host_);

	if (host.os !== "linux") {
		let hostString = std.Triple.toString(host);
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

	let env = [bootstrap.make.build(arg), env_];

	let output = await buildUtil(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
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

export let test = tg.target(async () => {
	let directory = build({ sdk: { bootstrapMode: true } });
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
