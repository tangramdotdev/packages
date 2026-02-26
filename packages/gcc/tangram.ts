import * as std from "std" with { local: "../std" };
import binutils from "binutils" with { local: "../binutils.tg.ts" };
import * as glibc from "glibc" with { local: "../glibc.tg.ts" };
import libgompConstFix from "./gcc-libgomp-const-fix.patch" with { type: "file" };
import musl from "musl" with { local: "../musl" };
import perl from "perl" with { local: "../perl" };
import python from "python" with { local: "../python" };
import texinfo from "texinfo" with { local: "../texinfo.tg.ts" };
import zstd from "zstd" with { local: "../zstd.tg.ts" };

export const metadata = {
	homepage: "https://gcc.gnu.org/",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-3.0-or-later",
	name: "gcc",
	repository: "https://gcc.gnu.org/git.html",
	version: "15.2.0",
	tag: "gcc/15.2.0",
	provides: {
		binaries: ["gcc"],
	},
};

/* This function produces a GCC source directory with the gmp, mpfr, isl, and mpc sources included. */
export const source = () =>
	tg.directory(gccSource(), {
		gmp: std.dependencies.gmp.source(),
		isl: std.dependencies.isl.source(),
		mpfr: std.dependencies.mpfr.source(),
		mpc: std.dependencies.mpc.source(),
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
		defaultCrossArgs: false,
		defaultCrossEnv: false,
		env,
		fortifySource: false,
		phases,
		opt: "3",
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
		defaultCrossArgs: false,
		defaultCrossEnv: false,
		env,
		fortifySource: false,
		phases,
		opt: "3",
		sdk: arg.sdk,
		source: arg.source,
	});

	const libgccFile = tg.File.expect(await result.get("lib/libgcc_s.so"));

	return libgccFile;
};

export const gccSource = async () => {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const checksum =
		"sha256:438fd996826b0c82485a29da03a72d71d6e3541a83ec702df4271f6fe025d24e";
	const base = `http://ftpmirror.gnu.org/gnu/${name}/${name}-${version}`;
	const source = await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
	return std.patch(source, libgompConstFix);
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
