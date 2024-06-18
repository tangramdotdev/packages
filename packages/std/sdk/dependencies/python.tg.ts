import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.tg.ts";

export let metadata = {
	name: "Python",
	version: "3.12.4",
};

export let source = tg.target(async (os: string) => {
	let { name, version } = metadata;

	let extension = ".tar.xz";
	let packageArchive = std.download.packageArchive({
		extension,
		name,
		version,
	});

	let checksum =
		"sha256:f6d419a6d8743ab26700801b4908d26d97e8b986e14f95de31b32de2b0e79554";
	let url = `https://www.python.org/ftp/python/${version}/${packageArchive}`;
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
	let os = std.triple.os(build);

	// Allow loading libraries from the compile-time library path.
	let prepare = `export LD_LIBRARY_PATH=$LIBRARY_PATH`;

	let configure = {
		args: [
			"--disable-test-modules",
			"--with-ensurepip=no",
			"--without-c-locale-coercion",
			"--without-readline",
		],
	};

	let phases = { prepare, configure };

	let providedCc = await std.env.tryGetKey({ env: env_, key: "CC" });
	if (providedCc) {
		configure.args.push(`CC="$CC"`);
	}

	let env = std.env.arg(env_, std.utils.env({ build, host, sdk }));

	// Build python.
	let result = std.autotools.build({
		...std.triple.rotate({ build, host }),
		env,
		phases,
		sdk,
		source: source_ ?? source(os),
	});

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
