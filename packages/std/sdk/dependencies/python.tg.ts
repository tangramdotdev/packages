import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.tg.ts";

export let metadata = {
	name: "Python",
	version: "3.12.4",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let extension = ".tar.xz";
	let checksum =
		"sha256:f6d419a6d8743ab26700801b4908d26d97e8b986e14f95de31b32de2b0e79554";
	let base = `https://www.python.org/ftp/python/${version}`;
	return await std
		.download({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let {
		autotools = {},
		build: build_,
		env,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;
	let os = std.triple.os(build);

	let configure = {
		args: [
			"--disable-test-modules",
			"--with-ensurepip=no",
			"--without-c-locale-coercion",
			"--without-readline",
		],
	};

	let phases = { configure };

	let providedCc = await std.env.tryGetKey({ env, key: "CC" });
	if (providedCc) {
		configure.args.push(`CC="$CC"`);
	}

	// Build python.
	let result = std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
			sdk,
			setRuntimeLibraryPath: true,
			source: source_ ?? source(),
		},
		autotools,
	);

	return result;
});

export default build;

export let test = tg.target(async () => {
	let host = await bootstrap.toolchainTriple(await std.triple.host());
	let sdkArg = await bootstrap.sdk.arg(host);
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["python3"],
		metadata,
		sdk: sdkArg,
	});
	return true;
});
