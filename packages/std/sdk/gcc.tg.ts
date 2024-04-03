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
	target?: string;
	variant: Variant;
};

export type Variant =
	| "stage1_bootstrap" // C only, no libraries.
	| "stage1_limited" // C/C++ only, most libraries disabled, but inclded libgcc/libstdc++.
	| "stage2_full" // Everything enabled.
	| "stage2_cross"; // Everything enabled, but with a build sysroot.

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

	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;
	let target = target_ ?? host;

	// Set up configuration common to all GCC builds.
	let commonArgs = [
		"--disable-bootstrap",
		"--disable-dependency-tracking",
		"--disable-nls",
		"--disable-multilib",
		`--build=${build}`,
		`--host=${host}`,
		`--target=${target}`,
		"--with-native-system-header-dir=/include",
		"--with-sysroot=$SYSROOT",
	];

	// Configure sysroot. If host != target, it will live in a target-prefixed subdirectory. If host == target, it will share the toplevel.
	let isCross = host !== target;
	let targetPrefix = isCross ? `${target}-` : "";
	let sysroot = isCross ? `$OUTPUT/${target}` : `$OUTPUT`;
	//let sysroot = "$OUTPUT";
	// The sysroot passed in the args is always nested in a directory named for the triple. If we're not cross-compiling, we need to reach inside this subdir.
	let incomingSysroot = isCross ? sysroot_ : tg`${sysroot_}/${target}`;

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
			`--with-glibc-version=${defaultGlibcVersion}`,
		];
		additionalArgs.push(...stage1BootstrapArgs);
	}

	if (variant === "stage1_limited") {
		let stage1LimitedArgs = [
			"--with-build-sysroot=$SYSROOT",
			"--disable-libatomic",
			"--disable-libgomp",
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
			CC: `${host}-cc -static -fPIC`,
			CXX: `${host}-c++ -static -fPIC`,
		};
	}

	if (variant === "stage2_cross") {
		let stage2FullArgs = [
			"--with-build-sysroot=$SYSROOT",
			"--enable-default-ssp",
			"--enable-default-pie",
			"--enable-initfini-array",
		];
		additionalArgs.push(...stage2FullArgs);
		additionalEnv = {
			...additionalEnv,
			CC: `${host}-cc -static -fPIC`,
			CXX: `${host}-c++ -static -fPIC`,
		};
	}

	let configure = { args: [...commonArgs, ...additionalArgs] };

	let phases = { prepare, configure };

	let env: tg.Unresolved<Array<std.env.Arg>> = [env_];
	if (rest.bootstrapMode) {
		let bootstrapMode = true;
		env = env.concat([
			std.utils.env({ bootstrapMode, env: env_, host: build }),
			dependencies.perl.build({
				bootstrapMode,
				env: env_,
				host: build,
			}),
			dependencies.python.build({
				bootstrapMode,
				env: env_,
				host: build,
			}),
			dependencies.zstd.build({
				bootstrapMode,
				env: env_,
				host: build,
			}),
		]);
	}
	env = env.concat([additionalEnv]);

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
	let { host, target, toolchainDir } = arg;
	let targetTriple = target ?? host;
	let gccVersion = await getGccVersion(toolchainDir, host, target);
	let isCross = host !== targetTriple;

	let sysroot = isCross ? tg`${toolchainDir}/${target}` : toolchainDir;

	let ccArgs = [
		tg`--sysroot=${sysroot}`,
		tg`-B${toolchainDir}/lib/gcc/${target}/${gccVersion}`,
		tg`-B${toolchainDir}/libexec/gcc/${target}/${gccVersion}`,
	];
	let fortranArgs = ccArgs;

	let cxxToplevel = isCross ? tg`${toolchainDir}/${target}` : toolchainDir;

	let cxxArgs = [
		...ccArgs,
		tg`-isystem${cxxToplevel}/include/c++/${gccVersion}`,
		tg`-isystem${cxxToplevel}/include/c++/${gccVersion}/${target}`,
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
