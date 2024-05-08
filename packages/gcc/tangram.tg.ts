import * as std from "tg:std" with { path: "../std" };
import binutils from "tg:binutils" with { path: "../binutils" };
import glibc from "tg:glibc" with { path: "../glibc" };
import musl from "tg:musl" with { path: "../musl" };
import perl from "tg:perl" with { path: "../perl" };
import python from "tg:python" with { path: "../python" };
import texinfo from "tg:texinfo" with { path: "../texinfo" };
import zstd from "tg:zstd" with { path: "../zstd" };

export let metadata = {
	homepage: "https://gcc.gnu.org/",
	license: "GPL-3.0-or-later",
	name: "gcc",
	repository: "https://gcc.gnu.org/git.html",
	version: "14.1.0",
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

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
	target?: string;
};

export let gcc = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		target: target_,
		...rest
	} = arg ?? {};

	let host = std.sdk.canonicalTriple(host_ ?? (await std.triple.host()));
	let os = std.triple.os(host);
	if (os !== "linux") {
		throw new Error("GCC is only supported on Linux");
	}
	let build = std.sdk.canonicalTriple(build_ ?? host);
	let target = std.sdk.canonicalTriple(target_ ?? host);

	let deps = [
		binutils({ build, host: build, target: build }),
		perl({ host: build }),
		python({ host: build }),
		texinfo({ host: build }),
		zstd({ host: build }),
	];

	// Set up configuration common to all GCC builds.
	let commonArgs = [
		"--disable-bootstrap",
		"--disable-dependency-tracking",
		"--disable-nls",
		"--disable-multilib",
		"--enable-default-ssp",
		"--enable-default-pie",
		"--enable-host-pie",
		"--enable-host-bind-now",
		"--enable-initfini-array",
		`--with-native-system-header-dir=/include`,
		tg`--with-sysroot=${libc(target)}`,
		`--build=${build}`,
		`--host=${host}`,
		`--target=${target}`,
	];

	// Set up containers to collect additional arguments and environment variables for specific configurations.
	let additionalArgs = [];
	let additionalEnv: std.env.Arg = {};

	// For Musl targets, disable libsanitizer regardless of build configuration. See https://wiki.musl-libc.org/open-issues.html
	if (std.triple.environment(target) === "musl") {
		additionalArgs.push("--disable-libsanitizer");
		additionalArgs.push("--disable-libitm");
		additionalArgs.push("--disable-libvtv");
	}

	// On GLIBC hosts, enable cxa_atexit.
	if (std.triple.environment(host) === "gnu") {
		additionalArgs.push("--enable-__cxa_atexit");
	}

	let configure = { args: [...commonArgs, ...additionalArgs] };

	let phases = { configure };

	let env = [additionalEnv, ...deps, env_];

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
	let isCross = host !== target;
	let targetPrefix = isCross ? `${target}-` : "";
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

export default gcc;

export let libgcc = tg.target(async (arg?: Arg) => {
	// FIXME - write in terms of gcc above, pass phases down.
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		target: target_,
		...rest
	} = arg ?? {};

	let host = std.sdk.canonicalTriple(host_ ?? (await std.triple.host()));
	let os = std.triple.os(host);
	if (os !== "linux") {
		throw new Error("GCC is only supported on Linux");
	}
	let build = std.sdk.canonicalTriple(build_ ?? host);
	let target = std.sdk.canonicalTriple(target_ ?? host);

	let deps = [
		binutils({ build, host: build, target: build }),
		perl({ host: build }),
		python({ host: build }),
		texinfo({ host: build }),
		zstd({ host: build }),
	];

	// Set up configuration common to all GCC builds.
	let commonArgs = [
		"--disable-bootstrap",
		"--disable-dependency-tracking",
		"--disable-nls",
		"--disable-multilib",
		"--enable-default-ssp",
		"--enable-default-pie",
		"--enable-host-pie",
		"--enable-host-bind-now",
		"--enable-initfini-array",
		"--enable-languages=c",
		`--with-native-system-header-dir=/include`,
		tg`--with-sysroot=${libc(target)}`,
		`--build=${build}`,
		`--host=${host}`,
		`--target=${target}`,
	];

	// Set up containers to collect additional arguments and environment variables for specific configurations.
	let additionalArgs = [];
	let additionalEnv: std.env.Arg = {};

	// For Musl targets, disable libsanitizer regardless of build configuration. See https://wiki.musl-libc.org/open-issues.html
	if (std.triple.environment(target) === "musl") {
		additionalArgs.push("--disable-libsanitizer");
		additionalArgs.push("--disable-libitm");
		additionalArgs.push("--disable-libvtv");
	}

	// On GLIBC hosts, enable cxa_atexit.
	if (std.triple.environment(host) === "gnu") {
		additionalArgs.push("--enable-__cxa_atexit");
	}

	let configure = { args: [...commonArgs, ...additionalArgs] };
	let buildPhase = tg.Mutation.set(`
		make -j$(nproc) all-gcc
		make -j$(nproc) all-target-libgcc
	`);
	let install = tg.Mutation.set(`
		make install-target-libgcc
	`);

	let phases = { configure, build: buildPhase, install };

	let env = [additionalEnv, ...deps, env_];

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

	let libgcc = tg.File.expect(await result.get("lib/libgcc_s.so"));

	return libgcc;
});

export let gccSource = tg.target(async () => {
	let { name, version } = metadata;
	let extension = ".tar.gz";
	let packageArchive = std.download.packageArchive({
		name,
		version,
		extension,
	});
	let checksum =
		"sha256:e283c654987afe3de9d8080bc0bd79534b5ca0d681a73a11ff2b5d3767426840";
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

/** Select the correct libc for the host. */
export let libc = (host: string) => {
	let environment = std.triple.environment(std.triple.normalize(host));
	switch (environment) {
		case "musl":
			return musl({ host });
		case "gnu":
			return glibc({ host });
		default:
			throw new Error(`Unsupported environment: ${environment}`);
	}
};

/** Merge all lib and lib64 directories into a single lib directory, leaving a symlink. */
export let mergeLibDirs = async (dir: tg.Directory) => {
	for await (let [name, artifact] of dir) {
		// If we find a lib64, merge it with the adjacent lib.
		if (tg.Directory.is(artifact)) {
			if (name === "lib64") {
				let maybeLibDir = await dir.tryGet("lib");
				if (!maybeLibDir) {
					// There was no adjacent lib - this is best effort. Do nothing.
					continue;
				}
				// If we found it, deep merge the lib64 into it.
				let libDir = maybeLibDir;
				tg.assert(tg.Directory.is(libDir));
				let mergedLibDir = await tg.directory(libDir, artifact);

				// Recurse into the merged lib directory.
				mergedLibDir = await mergeLibDirs(mergedLibDir);

				// Replace the original lib directory with the merged one, and add a symlink.
				dir = await tg.directory(dir, {
					lib: mergedLibDir,
					lib64: tg.symlink("lib"),
				});
			} else {
				// For all other directories, just recurse.
				let mergedSubdir = await mergeLibDirs(artifact);
				dir = await tg.directory(dir, {
					[name]: mergedSubdir,
				});
			}
		}
	}
	return dir;
};

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: gcc,
		binaries: ["gcc"],
		metadata,
	});
	return true;
});
