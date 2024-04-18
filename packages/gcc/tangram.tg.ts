import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "gcc",
	version: "13.2.0",
};

/* This function produces a GCC source directory with the gmp, mpfr, isl, and mpc sources included. */
export let source = tg.target(() =>
	tg.directory(gccSource(), {
		gmp: gmpSource(),
		isl: islSource(),
		mpfr: mpfrSource(),
		mpc: mpcSource(),
	}),
);

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
	target?: string;
};

/* Produce a GCC toolchain. */
export let build = tg.target(async (arg: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		target: target_,
		...rest
	} = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;
	let target = target_ ? tg.triple(target_) : host;

	let build = std.triple.toString(build);
	let host = std.triple.toString(host);
	let target = std.triple.toString(target);

	// Set up configuration common to all GCC builds.
	let commonArgs = [
		"--disable-dependency-tracking",
		"--disable-nls",
		"--disable-multilib",
		"--enable-default-ssp",
		"--enable-default-pie",
		"--enable-initfini-array",
		`--build=${build}`,
		`--host=${host}`,
		`--target=${target}`,
	];

	// Set up containers to collect additional arguments and environment variables for specific configurations.
	let additionalArgs = [];
	let additionalEnv: std.env.Arg = {
		MAKEFLAGS: "--output-sync --silent",
	};

	// For Musl targets, disable libsanitizer regardless of build configuration. See https://wiki.musl-libc.org/open-issues.html
	if (target.environment === "musl") {
		additionalArgs.push("--disable-libsanitizer");
		additionalArgs.push("--disable-libitm");
		additionalArgs.push("--disable-libvtv");
	}

	// On GLIBC hosts, enable cxa_atexit.
	if (host.environment === "gnu") {
		additionalArgs.push("--enable-__cxa_atexit");
	}

	let configure = { args: [...commonArgs, ...additionalArgs] };

	let phases = { prepare, configure };

	let env = [additionalEnv, env_];

	let result = await std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases,
			opt: "2",
			source: source_ ?? source(),
		},
		autotools,
	);

	result = await mergeLibDirs(result);

	// Add cc symlinks.
	result = await tg.directory(result, {
		[`bin/${targetPrefix}cc`]: tg.symlink(`./${targetPrefix}gcc`),
	});
	if (!isCross) {
		result = await tg.directory(result, {
			[`bin/${host}-cc`]: tg.symlink(`./${host}-gcc`),
		});
	}

	return result;
});

export default build;

export let gccSource = tg.target(async () => {
	let { name, version } = metadata;
	let extension = ".tar.gz";
	let packageArchive = std.download.packageArchive({
		name,
		version,
		extension,
	});
	let checksum =
		"sha256:8cb4be3796651976f94b9356fa08d833524f62420d6292c5033a9a26af315078";
	let url = `https://ftp.gnu.org/gnu/${name}/${name}-${version}/${packageArchive}`;
	let outer = tg.Directory.expect(await std.download({ checksum, url }));
	return std.directory.unwrap(outer);
});

export let gmpSource = tg.target(async () => {
	let name = "gmp";
	let version = "6.2.1";
	let extension = ".tar.xz";
	let packageArchive = std.download.packageArchive({
		name,
		version,
		extension,
	});
	let checksum =
		"sha256:fd4829912cddd12f84181c3451cc752be224643e87fac497b69edddadc49b4f2";
	let url = `https://gmplib.org/download/gmp/${packageArchive}`;
	let outer = tg.Directory.expect(await std.download({ checksum, url }));
	return std.directory.unwrap(outer);
});

export let islSource = tg.target(async () => {
	let name = "isl";
	let version = "0.24";
	let extension = ".tar.xz";
	let packageArchive = std.download.packageArchive({
		name,
		version,
		extension,
	});
	let checksum =
		"sha256:043105cc544f416b48736fff8caf077fb0663a717d06b1113f16e391ac99ebad";
	let url = `https://libisl.sourceforge.io/${packageArchive}`;
	let outer = tg.Directory.expect(await std.download({ checksum, url }));
	return std.directory.unwrap(outer);
});

export let mpcSource = tg.target(() => {
	let name = "mpc";
	let version = "1.2.1";
	let checksum =
		"sha256:17503d2c395dfcf106b622dc142683c1199431d095367c6aacba6eec30340459";
	return std.download.fromGnu({ checksum, name, version });
});

export let mpfrSource = tg.target(async () => {
	let name = "mpfr";
	let version = "4.1.0";
	let checksum =
		"sha256:feced2d430dd5a97805fa289fed3fc8ff2b094c02d05287fd6133e7f1f0ec926";
	return std.download.fromGnu({
		checksum,
		name,
		version,
		compressionFormat: "bz2",
	});
});
