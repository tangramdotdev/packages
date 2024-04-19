import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.tg.ts";

export let metadata = {
	name: "Python",
	version: "3.12.3",
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
		"sha256:56bfef1fdfc1221ce6720e43a661e3eb41785dd914ce99698d8c7896af4bdaa1";
	let url = `https://www.python.org/ftp/python/${version}/${packageArchive}`;
	let source = tg.Directory.expect(await std.download({ url, checksum }));
	source = await std.directory.unwrap(source);

	if (os === "darwin") {
		// Apply patch to use uname from coreutils instead of /usr/bin/arch.
		let macosPatch = tg.File.expect(
			await tg.include("./python_macos_arch.patch"),
		);

		source = await bootstrap.patch(source, macosPatch);
	}
	return source;
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
	let os = std.triple.os(build);

	let additionalEnv: std.env.Arg = {
		TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: "resolve",
	};
	if (os === "darwin") {
		additionalEnv = {
			...additionalEnv,
			MACOSX_DEPLOYMENT_TARGET: "14.4",
		};
	}

	let configure = {
		args: [
			"--disable-test-modules",
			"--with-ensurepip=no",
			"--without-c-locale-coercion",
			"--without-readline",
		],
	};

	// NOTE - the current llvm SDK does not support profiling required to enable PGO. For now, don't enable PGO if an explicit CC was passed.
	let providedCc = await std.env.tryGetKey({ env: env_, key: "CC" });
	if (providedCc) {
		configure.args.push(`CC="$CC"`);
	}

	let env = [env_, std.utils.env({ ...rest, build, host }), additionalEnv];

	// Build python.
	let result = std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases: { configure },
			source: source_ ?? source(os),
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
