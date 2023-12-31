import * as bootstrap from "../bootstrap.tg.ts";
import { mergeLibDirs } from "../sdk.tg.ts";
import * as std from "../tangram.tg.ts";
import * as dependencies from "./dependencies.tg.ts";
import { interpreterName } from "./libc.tg.ts";
import { defaultGlibcVersion } from "./libc/glibc.tg.ts";

export { toolchain, crossToolchain } from "./gcc/toolchain.tg.ts";

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
	binutils: tg.Directory;
	source?: tg.Directory;
	sysroot: tg.Directory;
	target?: std.Triple.Arg;
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
		binutils,
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		sysroot: sysroot_,
		target: target_,
		variant,
		...rest
	} = arg ?? {};

	let host = host_ ? std.triple(host_) : await std.Triple.host();
	let build = build_ ? std.triple(build_) : host;
	let target = target_ ? std.triple(target_) : host;

	let buildString = std.Triple.toString(build);
	let hostString = std.Triple.toString(host);
	let targetString = std.Triple.toString(target);

	// Set up configuration common to all GCC builds.
	let commonArgs = [
		"--disable-dependency-tracking",
		"--disable-nls",
		"--disable-multilib",
		`--build=${buildString}`,
		`--host=${hostString}`,
		`--target=${targetString}`,
		"--with-native-system-header-dir=/include",
		"--with-sysroot=$SYSROOT",
	];

	// Configure sysroot. If host != target, it will live in a target-prefixed subdirectory. If host == target, it will share the toplevel.
	let isCross = !std.Triple.eq(host, target);
	let targetPrefix = isCross ? `${targetString}-` : "";
	let sysroot = isCross ? `$OUTPUT/${targetString}` : `$OUTPUT`;
	// The sysroot passed in the args is always nested in a directory named for the triple. If we're not cross-compiling, we need to reach inside this subdir.
	let incomingSysroot = isCross ? sysroot_ : tg`${sysroot_}/${targetString}`;

	// Prepare output.
	let prepare = tg`
		mkdir -p $OUTPUT
		chmod -R u+w $OUTPUT
		cp -R ${arg.binutils}/* $OUTPUT
		chmod -R u+w $OUTPUT
		cp -R ${incomingSysroot}/* $OUTPUT
		chmod -R u+w $OUTPUT
		export SYSROOT="${sysroot}"
	`;

	// Set up containers to collect additional arguments and environment variables for specific configurations.
	let additionalArgs = [];
	let additionalEnv: std.env.Arg = {};

	// On Musl hosts, disable libsanitizer regardless of build configuration. See https://wiki.musl-libc.org/open-issues.html
	if (host.environment === "musl") {
		additionalArgs.push("--disable-libsanitizer");
	}

	// On GLIBC hosts, enable cxa_atexit.
	if (host.environment === "gnu") {
		additionalArgs.push("--enable-__cxa_atexit");
	}

	if (variant === "stage1_bootstrap") {
		// Set args.
		let stage1BootstrapArgs = [
			"--disable-bootstrap",
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
			`--with-glibc-version=${defaultGlibcVersion}`,
		];
		additionalArgs.push(...stage1BootstrapArgs);
	}

	if (variant === "stage1_limited") {
		let stage1LimitedArgs = [
			"--with-build-sysroot=$SYSROOT",
			"--disable-bootstrap",
			"--disable-libatomic",
			"--disable-libgomp",
			"--disable-libquadmath",
			"--disable-libvtv",
			"--disable-werror",
			"--enable-default-ssp",
			"--enable-default-pie",
			"--enable-initfini-array",
		];
		additionalArgs.push(...stage1LimitedArgs);
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
			CC: `${targetString}-cc -static -fPIC`,
			CXX: `${targetString}-c++ -static -fPIC`,
		};
	}

	let configure = { args: [...commonArgs, ...additionalArgs] };

	let phases = { prepare, configure };

	let env = [
		dependencies.env({ host: build, sdk: rest.sdk }),
		additionalEnv,
		env_,
	];

	let result = await std.autotools.build(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
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
			[`bin/${hostString}-cc`]: tg.symlink(`./${hostString}-gcc`),
		});
	}

	return result;
});

export default build;

export let gccSource = tg.target(async () => {
	let { name, version } = metadata;
	let unpackFormat = ".tar.gz" as const;
	let checksum =
		"sha256:8cb4be3796651976f94b9356fa08d833524f62420d6292c5033a9a26af315078";
	let url = `https://ftp.gnu.org/gnu/${name}/${name}-${version}/${name}-${version}${unpackFormat}`;
	let outer = tg.Directory.expect(
		await std.download({ checksum, url, unpackFormat }),
	);
	return std.directory.unwrap(outer);
});

export let gmpSource = tg.target(async () => {
	let name = "gmp";
	let version = "6.2.1";
	let unpackFormat = ".tar.xz" as const;
	let checksum =
		"sha256:fd4829912cddd12f84181c3451cc752be224643e87fac497b69edddadc49b4f2";
	let url = `https://gmplib.org/download/gmp/${name}-${version}${unpackFormat}`;
	let outer = tg.Directory.expect(
		await std.download({ checksum, url, unpackFormat }),
	);
	return std.directory.unwrap(outer);
});

export let islSource = tg.target(async () => {
	let name = "isl";
	let version = "0.24";
	let unpackFormat = ".tar.xz" as const;
	let checksum =
		"sha256:043105cc544f416b48736fff8caf077fb0663a717d06b1113f16e391ac99ebad";
	let url = `https://libisl.sourceforge.io/${name}-${version}${unpackFormat}`;
	let outer = tg.Directory.expect(
		await std.download({ checksum, url, unpackFormat }),
	);
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
	let compressionFormat = ".bz2" as const;
	return std.download.fromGnu({ checksum, name, version, compressionFormat });
});

export let libPath = "lib";

export let linkerPath = (triple: std.Triple.Arg) =>
	`${std.Triple.toString(std.triple(triple))}/bin/ld`;

export let crossLinkerPath = (target: std.Triple.Arg) =>
	`${std.Triple.toString(std.triple(target))}/bin/ld`;

export { interpreterName } from "./libc.tg.ts";

export let interpreterPath = (host: std.Triple.Arg) =>
	`${libPath}/${interpreterName(host)}`;

type WrapArgsArg = {
	host: std.Triple;
	target?: std.Triple;
	toolchainDir: tg.Directory;
};

/** Produce the set of flags required to enable proxying a statically-linked toolchain dir. */
export let wrapArgs = async (arg: WrapArgsArg) => {
	let { host, target, toolchainDir } = arg;
	let targetTriple = target ?? host;
	let targetString = std.Triple.toString(targetTriple);
	let gccVersion = await getGccVersion(toolchainDir, host, target);
	let isCross = !std.Triple.eq(host, targetTriple);

	let sysroot = isCross ? tg`${toolchainDir}/${targetString}` : toolchainDir;

	let ccArgs = [
		tg`--sysroot=${sysroot}`,
		tg`-B${toolchainDir}/lib/gcc/${targetString}/${gccVersion}`,
		tg`-B${toolchainDir}/libexec/gcc/${targetString}/${gccVersion}`,
	];
	let fortranArgs = ccArgs;

	let cxxToplevel = isCross
		? tg`${toolchainDir}/${targetString}`
		: toolchainDir;

	let cxxArgs = [
		...ccArgs,
		tg`-isystem${cxxToplevel}/include/c++/${gccVersion}`,
		tg`-isystem${cxxToplevel}/include/c++/${gccVersion}/${targetString}`,
	];

	return { ccArgs, cxxArgs, fortranArgs };
};

async function getGccVersion(
	env: std.env.Arg,
	host: std.Triple,
	target?: std.Triple,
): Promise<string> {
	let targetTriple = target ?? host;
	let targetPrefix = std.Triple.eq(host, targetTriple)
		? ``
		: `${std.Triple.toString(targetTriple)}-`;
	await std.env.assertProvides({ env, name: `${targetPrefix}gcc` });
	let script = tg`${targetPrefix}gcc --version | awk '/^${targetPrefix}gcc / {print $3}' > $OUTPUT`;
	// We always need an `awk`, but don't care where it comes from. Users should be able to just provide a toolchain dir and have this target work.
	let envObject = std.env.object(bootstrap.utils(), env);
	let result = tg.File.expect(await tg.build(script, { env: envObject }));
	return (await result.text()).trim();
}
