import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.tg.ts";
import bison from "./bison.tg.ts";
import m4 from "./m4.tg.ts";
import make from "./make.tg.ts";
import pkgConfig from "./pkg_config.tg.ts";

export let metadata = {
	name: "Python",
	version: "3.12.1",
};

export let source = tg.target(async (os: tg.System.Os) => {
	let { name, version } = metadata;

	let unpackFormat = ".tar.xz" as const;
	let packageArchive = std.download.packageArchive({
		name,
		version,
		unpackFormat,
	});

	let checksum =
		"sha256:8dfb8f426fcd226657f9e2bd5f1e96e53264965176fa17d32658e873591aeb21";
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

	let host = await std.Triple.host(host_);
	let build = build_ ? std.triple(build_) : host;
	let os = build.os;

	let additionalEnv: std.env.Arg = {
		TANGRAM_LINKER_LIBRARY_PATH_OPT_LEVEL: "resolve",
	};
	if (os === "darwin") {
		additionalEnv = {
			...additionalEnv,
			MACOSX_DEPLOYMENT_TARGET: "14.2",
		};
	} else if (os === "linux") {
		additionalEnv = {
			...additionalEnv,
			// Note -required to support PGO with the default SDK..
			LDFLAGS: await tg.Mutation.templatePrepend("-lgcov --coverage", " "),
		};
	}

	let configure = {
		args: [
			"--disable-test-modules",
			"--without-readline",
			"--with-ensurepip=no",
			"--enable-optimizations",
		],
	};
	let dependencies = [bison(arg), m4(arg), make(arg), pkgConfig(arg)];

	let env = [std.utils.env(arg), ...dependencies, additionalEnv, env_];

	// Build python.
	let result = std.autotools.build(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
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
	let host = bootstrap.toolchainTriple(await std.Triple.host());
	await std.assert.pkg({
		directory: build({ host, sdk: { bootstrapMode: true } }),
		binaries: ["python3"],
		metadata,
	});
	return true;
});
