import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.tg.ts";
import bison from "./bison.tg.ts";
import bzip2 from "./bzip2.tg.ts";
import libxcrypt from "./libxcrypt.tg.ts";
import m4 from "./m4.tg.ts";
import make from "./make.tg.ts";
import pkgConfig from "./pkg_config.tg.ts";

export let metadata = {
	name: "Python",
	version: "3.12.2",
};

export let source = tg.target(async (os: tg.Triple.Os) => {
	let { name, version } = metadata;

	let unpackFormat = ".tar.xz" as const;
	let packageArchive = std.download.packageArchive({
		name,
		version,
		unpackFormat,
	});

	let checksum =
		"sha256:be28112dac813d2053545c14bf13a16401a21877f1a69eb6ea5d84c4a0f3d870";
	let url = `https://www.python.org/ftp/python/${version}/${packageArchive}`;
	let source = tg.Directory.expect(
		await std.download({ url, checksum, unpackFormat }),
	);
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

	let host = await tg.Triple.host(host_);
	let build = build_ ? tg.triple(build_) : host;
	let os = build.os;
	tg.assert(os);

	let additionalEnv: std.env.Arg = {
		TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: "resolve",
	};
	if (os === "darwin") {
		additionalEnv = {
			...additionalEnv,
			MACOSX_DEPLOYMENT_TARGET: "14.3",
		};
	}

	let configure = {
		args: [
			"--disable-test-modules",
			"--without-readline",
			"--with-ensurepip=no",
		],
	};

	// NOTE - the current llvm SDK does not support profiling required to enable PGO. For now, don't enable PGO if an explicit CC was passed.
	let providedCc = await std.env.tryGetKey({ env: env_, key: "CC" });
	if (providedCc) {
		configure.args.push(`CC="$CC"`);
	} else {
		configure.args.push(`--enable-optimizations`);
	}

	let dependencies = [
		bison(arg),
		bzip2(arg),
		libxcrypt(arg),
		m4(arg),
		make(arg),
		pkgConfig(arg),
	];

	let env = [std.utils.env(arg), ...dependencies, additionalEnv, env_];

	// Build python.
	let result = std.autotools.build(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
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
	let host = bootstrap.toolchainTriple(await tg.Triple.host());
	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });
	let directory = build({ host, bootstrapMode, env: sdk });
	await std.assert.pkg({
		directory,
		binaries: ["python3"],
		metadata,
	});
	return directory;
});
