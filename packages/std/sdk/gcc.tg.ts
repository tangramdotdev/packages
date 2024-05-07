import * as bootstrap from "../bootstrap.tg.ts";
import { mergeLibDirs } from "../sdk.tg.ts";
import * as std from "../tangram.tg.ts";
import * as dependencies from "./dependencies.tg.ts";
import { interpreterName } from "./libc.tg.ts";
import { defaultGlibcVersion } from "./libc/glibc.tg.ts";

export { toolchain, crossToolchain } from "./gcc/toolchain.tg.ts";

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

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
	sysroot: tg.Directory;
	target?: string;
	variant: Variant;
};

export type Variant =
	| "stage1_bootstrap" // C only, no libraries.
	| "stage1_limited" // C/C++ only, most libraries disabled, but inclded libgcc/libstdc++.
	| "stage2_full"; // Everything enabled.

/* Produce a GCC toolchain capable of compiling C and C++ code. */
export let build = tg.target(async (arg: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		sysroot,
		target: target_,
		variant,
		...rest
	} = arg ?? {};

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;
	let target = target_ ?? host;

	// Set up configuration common to all GCC builds.
	let commonArgs = [
		"--disable-bootstrap",
		"--disable-dependency-tracking",
		"--disable-nls",
		"--disable-multilib",
		"--enable-host-bind-now",
		"--enable-host-pie",
		`--build=${build}`,
		`--host=${host}`,
		`--target=${target}`,
		"--with-native-system-header-dir=/include",
		tg`--with-sysroot=${sysroot}/${target}`,
	];

	// Configure sysroot.
	let isCross = host !== target;
	let targetPrefix = isCross ? `${target}-` : "";

	// Set up containers to collect additional arguments and environment variables for specific configurations.
	let additionalArgs = [];
	let additionalEnv = {};
	let debug = false;

	// For Musl targets, disable libsanitizer regardless of build configuration. See https://wiki.musl-libc.org/open-issues.html
	if (std.triple.environment(target) === "musl") {
		additionalArgs.push("--disable-libsanitizer");
		additionalArgs.push("--disable-libitm");
		additionalArgs.push("--disable-libvtv");
	}

	// On GLIBC hosts, enable cxa_atexit.
	let hostEnvironment = std.triple.environment(host);
	if (hostEnvironment === "gnu") {
		additionalArgs.push("--enable-__cxa_atexit");
	}

	if (variant === "stage1_bootstrap") {
		// Set args.
		let stage1BootstrapArgs = [
			"--disable-libatomic",
			"--disable-libgomp",
			"--disable-libquadmath",
			"--disable-libsanitizer",
			"--disable-libssp",
			"--disable-libstdcxx",
			"--disable-libvtv",
			"--disable-shared",
			"--disable-threads",
			"--disable-werror",
			"--enable-languages=c,c++",
			"--with-newlib",
			"--without-headers",
		];
		if (hostEnvironment === "gnu") {
			stage1BootstrapArgs.push(`--with-glibc-version=${defaultGlibcVersion}`);
		}
		additionalArgs.push(...stage1BootstrapArgs);
	}

	if (variant === "stage1_limited") {
		let stage1LimitedArgs = [
			"--disable-libatomic",
			"--disable-libgomp",
			"--disable-libvtv",
			"--disable-werror",
			"--enable-default-ssp",
			"--enable-default-pie",
			"--enable-initfini-array",
		];
		additionalArgs.push(...stage1LimitedArgs);
		debug = false;
	}

	if (variant === "stage2_full") {
		let stage2FullArgs = [
			"--enable-default-ssp",
			"--enable-default-pie",
			"--enable-initfini-array",
		];
		additionalArgs.push(...stage2FullArgs);
		additionalEnv = {
			...additionalEnv,
			CC: `cc -static -fPIC`,
			CXX: `c++ -static -fPIC`,
		};
	}

	let configure = { args: [...commonArgs, ...additionalArgs] };

	let phases = { configure };

	let env: tg.Unresolved<Array<std.env.Arg>> = [env_];
	let buildSdkArg = bootstrap.sdk.arg(build);
	env = env.concat([
		std.utils.env({ sdk: buildSdkArg, host: build }),
		dependencies.perl.build({
			sdk: buildSdkArg,
			host: build,
		}),
		dependencies.python.build({
			sdk: buildSdkArg,
			host: build,
		}),
		dependencies.zstd.build({
			sdk: buildSdkArg,
			host: build,
		}),
	]);
	env.push(additionalEnv);

	let result = await std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			debug,
			env: std.env.object(env),
			phases,
			opt: "3",
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
	let extension = ".tar.xz";
	let packageArchive = std.download.packageArchive({
		name,
		version,
		extension,
	});
	let checksum =
		"sha256:e283c654987afe3de9d8080bc0bd79534b5ca0d681a73a11ff2b5d3767426840";
	let url = `https://ftp.gnu.org/gnu/${name}/${name}-${version}/${packageArchive}`;
	return await std
		.download({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
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
	return await std
		.download({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
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
	return await std
		.download({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
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

export let libPath = "lib";

export let linkerPath = (triple: string) => `${triple}/bin/ld`;

export let crossLinkerPath = (target: string) => `${target}/bin/ld`;

export { interpreterName } from "./libc.tg.ts";

export let interpreterPath = (host: string) =>
	`${libPath}/${interpreterName(host)}`;

type WrapArgsArg = {
	host: string;
	target?: string;
	toolchainDir: tg.Directory;
};

/** Produce the set of flags required to enable proxying a statically-linked toolchain dir. */
export let wrapArgs = async (arg: WrapArgsArg) => {
	let { host, target: target_, toolchainDir } = arg;
	let target = target_ ?? host;
	let gccVersion = await getGccVersion(toolchainDir, host, target);
	let isCross = host !== target;
	let sysroot = isCross ? tg`${toolchainDir}/${target}` : toolchainDir;

	let ccArgs = [
		tg`--sysroot=${sysroot}`,
		tg`-B${toolchainDir}/lib/gcc/${target}/${gccVersion}`,
		tg`-B${toolchainDir}/libexec/gcc/${target}/${gccVersion}`,
	];
	let fortranArgs = ccArgs;

	let cxxArgs = [
		...ccArgs,
		tg`-isystem${sysroot}/include/c++/${gccVersion}`,
		tg`-isystem${sysroot}/include/c++/${gccVersion}/${target}`,
	];

	return { ccArgs, cxxArgs, fortranArgs };
};

async function getGccVersion(
	env: std.env.Arg,
	host: string,
	target?: string,
): Promise<string> {
	let targetTriple = target ?? host;
	let targetPrefix = host === targetTriple ? `` : `${targetTriple}-`;
	await std.env.assertProvides({ env, name: `${targetPrefix}gcc` });
	let script = tg`${targetPrefix}gcc --version | awk '/^${targetPrefix}gcc / {print $3}' > $OUTPUT`;
	// We always need an `awk`, but don't care where it comes from. Users should be able to just provide a toolchain dir and have this target work.
	let envObject = std.env.object(bootstrap.utils(), env);
	let result = tg.File.expect(await tg.build(script, { env: envObject }));
	return (await result.text()).trim();
}
