import * as bootstrap from "../../bootstrap.tg.ts";
import { mergeLibDirs } from "../../sdk.tg.ts";
import { interpreterName } from "../libc.tg.ts";
import { defaultGlibcVersion } from "../libc/glibc.tg.ts";
import * as dependencies from "../dependencies.tg.ts";
import * as std from "../../tangram.ts";

export const metadata = {
	homepage: "https://gcc.gnu.org/",
	license: "GPL-3.0-or-later",
	name: "gcc",
	repository: "https://gcc.gnu.org/git.html",
	version: "15.2.0",
};

/** Produce a GCC source directory with the gmp, mpfr, isl, and mpc sources optionally included. */
export const source = (bundledSources?: boolean) => {
	const { name, version } = metadata;

	// Download and unpack the GCC source.
	const extension = ".tar.xz";
	const checksum =
		"sha256:438fd996826b0c82485a29da03a72d71d6e3541a83ec702df4271f6fe025d24e";
	const base = `http://ftpmirror.gnu.org/gnu/${name}/${name}-${version}`;
	let sourceDir = std.download
		.extractArchive({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);

	// If requested, include the bundled sources as subdirectories.
	if (bundledSources) {
		sourceDir = tg.directory(sourceDir, {
			gmp: dependencies.gmp.source(),
			isl: dependencies.isl.source(),
			mpfr: dependencies.mpfr.source(),
			mpc: dependencies.mpc.source(),
		});
	}
	return sourceDir;
};

export type Arg = {
	autotools?: std.autotools.Arg;
	bootstrap?: boolean;
	build?: string;
	/** If this is true, add the gmp, mpfr, mpc, and isl source directories to the GCC source and build them all together. If false, these libraries must be available for the host in the env. */
	bundledSources?: boolean;
	/** This is used in the canadian cross case to allow the target libraries to build in the final compiler before we have a chance to proxy the linker. It is not necessary when building a cross-compiler. */
	crossNative?: boolean;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
	/**  This directory must contain a directory structure with a single toplevel directory named for the target triple, containing include/lib directories contains a libc matching the target triple and a set of Linux headers. They will be copied into the output. */
	sysroot: tg.Directory;
	target?: string;
	/** This directory must contain a set of binutils for the target. They will be copied into the output. */
	targetBinutils: tg.Directory;
	variant: Variant;
};

export type Variant =
	| "stage1_bootstrap" // C only, no libraries. Will produce an output directory with two folders, $OUTPUT/prefix with the installed compiler and $OUTPUT/build with the build artifacts.
	| "stage1_limited" // Produce a complete native `host === target` GCC toolchain with only C and C++ enabled and many features disabled.
	| "stage2_full"; // Everything enabled.

/* Produce a GCC toolchain capable of compiling C and C++ code. */
export const build = async (arg: tg.Unresolved<Arg>) => {
	const {
		autotools = {},
		bootstrap: bootstrap_ = false,
		build: build_,
		bundledSources = false,
		crossNative = false,
		env,
		host: host_,
		sdk,
		source: source_,
		sysroot,
		target: target_,
		targetBinutils,
		variant,
	} = await tg.resolve(arg);

	// Finalize triples.
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;
	const target = target_ ?? host;
	const isCross = host !== target;
	const hostEnvironment = std.triple.environment(host);

	// Assert the triples don't conflict with the requested configuratiion.
	if (variant === "stage1_limited") {
		tg.assert(isCross, "stage1_limited is for building cross-compilers");
	}
	if (crossNative) {
		tg.assert(!isCross, "crossNative requires host === target");
	}

	// Configure sysroot.
	const targetPrefix = isCross ? `${target}-` : "";
	const sysrootDir = `${isCross ? `/${target}` : ""}/sysroot`;
	const prefixSysrootPath = `$\{OUTPUT\}${sysrootDir}`;

	// Before configuring, copy the target binutils and sysroot into the prefix. Create a symlink in a subdirectory of the prefix to ensure the toolchain is relocatable.
	const sysrootToCopy = isCross
		? sysroot
		: sysroot.get(target).then(tg.Directory.expect);
	const prefixSeed = tg.directory(sysrootToCopy, targetBinutils);
	let preConfigureHook = tg`\nmkdir -p $OUTPUT\ncp -R ${prefixSeed}/* $OUTPUT\nchmod -R u+w $OUTPUT\nln -s . ${prefixSysrootPath}`;

	// Define args used for all variants.
	const commonConfigureArgs = [
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
		`--with-sysroot=${prefixSysrootPath}`,
	];

	// Define the args for each variant.
	const variantConfigureArgs = (variant: Variant) => {
		switch (variant) {
			case "stage1_bootstrap": {
				const args = [
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
					args.push(`--with-glibc-version=${defaultGlibcVersion}`);
				}
				return args;
			}
			case "stage1_limited":
				return [
					"--disable-libatomic",
					"--disable-libgomp",
					"--disable-libssp",
					"--disable-libvtv",
					"--enable-default-pie",
					"--enable-default-ssp",
					"--enable-initfini-array",
					`LDFLAGS_FOR_TARGET=-L$PWD/${target}/libgcc`,
					`--with-gxx-include-dir=$OUTPUT/${target}/include/c++/${metadata.version}`,
				];
			case "stage2_full":
				return [
					"--enable-default-ssp",
					"--enable-default-pie",
					"--enable-initfini-array",
				];
		}
	};

	// NOTE: Usually any `tg.Template.Arg` could be a valid configure arg. We restrict to strings here to avoid accidentally hardcoding a runtime dependency on a Tangram artifact instead of components included in this installation prefix.
	const configureArgs: Array<string> = [
		...commonConfigureArgs,
		...variantConfigureArgs(variant),
	];

	// For Musl targets, disable libsanitizer. See https://wiki.musl-libc.org/open-issues.html
	// NOTE - the stage1_bootstrap variant already includes this flag.
	const targetEnvironment = std.triple.environment(target);
	if (targetEnvironment === "musl" && variant !== "stage1_bootstrap") {
		configureArgs.push("--disable-libsanitizer");
	}

	// On GLIBC hosts, enable cxa_atexit.
	if (hostEnvironment === "gnu") {
		configureArgs.push("--enable-__cxa_atexit");
	}

	// If requested, include environment necessary to complete the target library builds with the fresh, unproxied compiler.
	if (crossNative) {
		const sysrootLibDir = `${prefixSysrootPath}/lib`;
		const sysrootLdso = `${sysrootLibDir}/${interpreterName(target)}`;
		const ldflagsForTarget = `-Wl,-dynamic-linker,${sysrootLdso}`;
		configureArgs.push(`LDFLAGS_FOR_TARGET=${ldflagsForTarget}`);
		preConfigureHook = tg`${preConfigureHook}\nexport LD_LIBRARY_PATH=${sysrootLibDir}\nexport WATERMARK=3`;
	}

	// Set up phases.
	const configure = {
		pre: preConfigureHook,
		body: {
			args: configureArgs,
		},
	};
	const phases = { configure };

	const shouldFortify = variant !== "stage2_full" && host === target;

	let result = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			bootstrap: bootstrap_,
			defaultCrossArgs: false,
			defaultCrossEnv: false,
			env,
			fortifySource: shouldFortify,
			phases,
			opt: "3",
			sdk,
			source: source_ ?? source(bundledSources),
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
};

export default build;

export { interpreterName } from "../libc.tg.ts";

export const interpreterPath = (target: string, isCross?: boolean) =>
	`${isCross ? `/${target}/sysroot` : "/"}lib/${interpreterName(target)}`;

type WrapArgsArg = {
	host: string;
	target?: string;
	toolchainDir: tg.Directory;
};

/** Produce the set of flags required to enable proxying a statically-linked toolchain dir. */
export const wrapArgs = async (arg: WrapArgsArg) => {
	const { host, target: target_, toolchainDir } = arg;
	const target = target_ ?? host;
	const hostOs = std.triple.os(host);
	const toolchainEnv = await std.env.arg(toolchainDir, { utils: false });
	const gccVersion = await getGccVersion(toolchainEnv, host, target);
	const isCross = host !== target;
	const sysroot =
		hostOs === "darwin"
			? tg`${toolchainDir}/${target}/sysroot`
			: isCross
				? tg`${toolchainDir}/${target}`
				: toolchainDir;

	const ccArgs = [
		//.Set the sysroot.
		tg`--sysroot=${sysroot}`,
		// Ensure the correct binutils are used.
		tg`-B${toolchainDir}/${target}/bin`,
		// Ensure the compiler's internals are found.
		tg`-B${toolchainDir}/lib/gcc/${target}/${gccVersion}`,
		tg`-B${toolchainDir}/libexec/gcc/${target}/${gccVersion}`,
	];

	// C++ and fortran gets the same args as the C compiler.
	const fortranArgs = ccArgs;
	const cxxArgs = ccArgs;

	return { ccArgs, cxxArgs, fortranArgs };
};

async function getGccVersion(
	env: std.env.EnvObject,
	host: string,
	target?: string,
): Promise<string> {
	const targetTriple = target ?? host;
	const targetPrefix = host === targetTriple ? `` : `${targetTriple}-`;
	await std.env.assertProvides({ env, name: `${targetPrefix}gcc` });
	// We always need an `awk`, but don't care where it comes from. Users should be able to just provide a toolchain dir and have this target work.
	const envObject = std.env.arg(bootstrap.utils(), bootstrap.shell(), env, {
		utils: false,
	});
	const result =
		await std.build`${targetPrefix}gcc --version | awk '/^${targetPrefix}gcc / {print $3}' > $OUTPUT`
			.bootstrap(true)
			.env(envObject)
			.then(tg.File.expect);
	return (await result.text()).trim();
}
