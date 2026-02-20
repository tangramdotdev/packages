import * as std from "std" with { local: "./std" };
import binutils from "binutils" with { local: "./binutils.tg.ts" };
import * as glibc from "glibc" with { local: "./glibc.tg.ts" };
import musl from "musl" with { local: "./musl" };
import perl from "perl" with { local: "./perl" };
import python from "python" with { local: "./python" };
import texinfo from "texinfo" with { local: "./texinfo.tg.ts" };
import zstd from "zstd" with { local: "./zstd.tg.ts" };

export const metadata = {
	homepage: "https://gcc.gnu.org/",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-3.0-or-later",
	name: "gcc",
	repository: "https://gcc.gnu.org/git.html",
	version: "14.1.0",
	tag: "gcc/14.1.0",
	provides: {
		binaries: ["gcc"],
	},
};

/* This function produces a GCC source directory with the gmp, mpfr, isl, and mpc sources included. */
export const source = () =>
	tg.directory(gccSource(), {
		gmp: gmpSource(),
		isl: islSource(),
		mpfr: mpfrSource(),
		mpc: mpcSource(),
	});

export type Arg = std.autotools.Arg & {
	target?: string;
};

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg({ source: source() }, ...args);

	const host = std.sdk.canonicalTriple(arg.host);
	const os = std.triple.os(host);
	std.assert.supportedHost(host, metadata);
	const build = std.sdk.canonicalTriple(arg.build);
	// Extract target from raw args since std.autotools.arg doesn't know about it.
	const targetArg = (await Promise.all(args.map(tg.resolve))).find(
		(a): a is { target?: string } =>
			a !== null && typeof a === "object" && "target" in a,
	);
	const target = std.sdk.canonicalTriple(targetArg?.target ?? host);

	const deps = [
		binutils({ build, host: build, target: build }),
		perl({ host: build }),
		python({ host: build }),
		texinfo({ host: build }),
		zstd({ host: build }),
	];

	// Set up configuration common to all GCC builds.
	const commonArgs = [
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
	const additionalArgs = [];
	const additionalEnv: std.env.Arg = {};

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

	const configure = { args: [...commonArgs, ...additionalArgs] };

	const phases = { configure };

	const env = std.env.arg(additionalEnv, ...deps, arg.env);

	let result = await std.autotools.build({
		...(await std.triple.rotate({ build, host })),
		env,
		phases,
		opt: "2",
		sdk: arg.sdk,
		source: arg.source,
	});

	result = await mergeLibDirs(result);

	// Add cc symlinks.
	const isCross = host !== target;
	const targetPrefix = isCross ? `${target}-` : "";
	result = await tg.directory(result, {
		[`bin/${targetPrefix}cc`]: tg.symlink(`./${targetPrefix}gcc`),
	});
	if (!isCross) {
		result = await tg.directory(result, {
			[`bin/${host}-cc`]: tg.symlink(`./${host}-gcc`),
		});
	}

	return result;
};

export default build;

export const libgcc = async (...args: std.Args<Arg>) => {
	// FIXME - write in terms of gcc above, pass phases down.
	const arg = await std.autotools.arg({ source: source() }, ...args);

	const host = std.sdk.canonicalTriple(arg.host);
	const os = std.triple.os(host);
	if (os !== "linux") {
		throw new Error("GCC is only supported on Linux");
	}
	const build = std.sdk.canonicalTriple(arg.build);
	// Extract target from raw args since std.autotools.arg doesn't know about it.
	const targetArg = (await Promise.all(args.map(tg.resolve))).find(
		(a): a is { target?: string } =>
			a !== null && typeof a === "object" && "target" in a,
	);
	const target = std.sdk.canonicalTriple(targetArg?.target ?? host);

	const deps = [
		binutils({ build, host: build, target: build }),
		perl({ host: build }),
		python({ host: build }),
		texinfo({ host: build }),
		zstd({ host: build }),
	];

	// Set up configuration common to all GCC builds.
	const commonArgs = [
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
	const additionalArgs = [];
	const additionalEnv: std.env.Arg = {};

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

	const configure = { args: [...commonArgs, ...additionalArgs] };
	const buildPhase = tg.Mutation.set(`
		make -j$(nproc) all-gcc
		make -j$(nproc) all-target-libgcc
	`);
	const install = tg.Mutation.set(`
		make install-target-libgcc
	`);

	const phases = { configure, build: buildPhase, install };

	const env = std.env.arg(additionalEnv, ...deps, arg.env);

	const result = await std.autotools.build({
		...(await std.triple.rotate({ build, host })),
		env,
		phases,
		opt: "2",
		sdk: arg.sdk,
		source: arg.source,
	});

	const libgccFile = tg.File.expect(await result.get("lib/libgcc_s.so"));

	return libgccFile;
};

export const gccSource = async () => {
	const { name, version } = metadata;
	const extension = ".tar.gz";
	const checksum =
		"sha256:e283c654987afe3de9d8080bc0bd79534b5ca0d681a73a11ff2b5d3767426840";
	const base = `https://ftp.gnu.org/gnu/${name}/${name}-${version}`;
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export const gmpSource = async () => {
	const name = "gmp";
	const version = "6.2.1";
	const extension = ".tar.xz";
	const checksum =
		"sha256:fd4829912cddd12f84181c3451cc752be224643e87fac497b69edddadc49b4f2";
	const base = `https://gmplib.org/download/${name}`;
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export const islSource = async () => {
	const name = "isl";
	const version = "0.24";
	const extension = ".tar.xz";
	const checksum =
		"sha256:043105cc544f416b48736fff8caf077fb0663a717d06b1113f16e391ac99ebad";
	const base = `https://libisl.sourceforge.io/`;
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export const mpcSource = () => {
	const name = "mpc";
	const version = "1.2.1";
	const checksum =
		"sha256:17503d2c395dfcf106b622dc142683c1199431d095367c6aacba6eec30340459";
	return std.download.fromGnu({ checksum, name, version });
};

export const mpfrSource = async () => {
	const name = "mpfr";
	const version = "4.1.0";
	const checksum =
		"sha256:feced2d430dd5a97805fa289fed3fc8ff2b094c02d05287fd6133e7f1f0ec926";
	return std.download.fromGnu({
		checksum,
		name,
		version,
		compression: "bz2",
	});
};

/** Select the correct libc sysroot for the host. Returns a directory with headers and libraries at the root level (include/, lib/). */
export const libc = async (host: string) => {
	const environment = std.triple.environment(std.triple.normalize(host));
	switch (environment) {
		case "musl":
			return musl({ host });
		case "gnu":
			// glibc.sysroot() returns a directory structured as ${host}/lib/, ${host}/include/. Extract the host subdirectory so that --with-sysroot finds headers and libraries at the root level.
			return glibc
				.sysroot({ host })
				.then((d) => d.get(host))
				.then(tg.Directory.expect);
		default:
			throw new Error(`Unsupported environment: ${environment}`);
	}
};

/** Merge all lib and lib64 directories into a single lib directory, leaving a symlink. */
export const mergeLibDirs = async (dir: tg.Directory) => {
	for await (const [name, artifact] of dir) {
		// If we find a lib64, merge it with the adjacent lib.
		if (artifact instanceof tg.Directory) {
			if (name === "lib64") {
				const maybeLibDir = await dir.tryGet("lib");
				if (!maybeLibDir) {
					// There was no adjacent lib - this is best effort. Do nothing.
					continue;
				}
				// If we found it, deep merge the lib64 into it.
				const libDir = maybeLibDir;
				tg.assert(libDir instanceof tg.Directory);
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
				const mergedSubdir = await mergeLibDirs(artifact);
				dir = await tg.directory(dir, {
					[name]: mergedSubdir,
				});
			}
		}
	}
	return dir;
};

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
