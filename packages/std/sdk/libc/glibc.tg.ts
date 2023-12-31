import * as std from "../../tangram.tg.ts";
import * as dependencies from "../dependencies.tg.ts";

// Define supported versions.
type GlibcVersion = "2.37" | "2.38";
export let defaultGlibcVersion: GlibcVersion = "2.38";

export let metadata = {
	name: "glibc",
};

export let source = tg.target((version?: GlibcVersion) => {
	let { name } = metadata;
	let version_ = version ?? defaultGlibcVersion;
	let compressionFormat = ".xz" as const;

	let checksum = checksums.get(version_);
	tg.assert(checksum, `Unsupported glibc version ${version}`);

	return std.download.fromGnu({
		name,
		version: version_,
		compressionFormat,
		checksum,
	});
});

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	linuxHeaders: tg.Directory;
	source?: tg.Directory;
	target?: std.Triple.Arg;
	version?: GlibcVersion;
};

export default tg.target(async (arg: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		linuxHeaders,
		source: source_,
		target: target_,
		version = defaultGlibcVersion,
		...rest
	} = arg;
	let host = host_ ? std.triple(host_) : await std.Triple.host();
	let build = build_ ? std.triple(build_) : host;
	let target = target_ ?? host;

	let hostTriple = std.triple(target ?? host);
	let buildString = std.Triple.toString(build);
	let hostString = std.Triple.toString(hostTriple);

	// Resolve remaining arguments.

	let additionalFlags = [];

	// The 2.38 release has some new configuration to manage.
	if (version === "2.38") {
		// This flag is not available in previous versions. The `-DFORTIFY_SOURCE` macro was already available to users of glibc. This flag additionally uses this macro to build libc itself. It's used to detect buffer overflows at compile time.
		if (host.environment === "gnu") {
			additionalFlags.push("--enable-fortify-source");
		}
		// libcrypt is now disabled by default, with a note that applications should prepare to migrate to new libcrypt providers like libxcrypt. GCC still expects libcrypt, so we opt-in. This may change in future iterations.
		additionalFlags.push("--enable-crypt");
	}

	let prepare = `mkdir -p $OUTPUT`;

	let configure = {
		args: [
			"--disable-nls",
			"--disable-werror",
			"--enable-kernel=4.14",
			tg`--with-headers="${linuxHeaders}/include"`,
			`--build=${buildString}`,
			`--host=${hostString}`,
			"libc_cv_slibdir=/lib",
			"libc_cv_forced_unwind=yes",
			...additionalFlags,
		],
	};

	let install = {
		command: tg`make DESTDIR="$OUTPUT/${hostString}" install`,
		args: tg.Mutation.unset(),
	};

	let phases = {
		prepare,
		configure,
		install,
	};

	let env = [
		dependencies.env({ host: build, sdk: rest.sdk }),
		{
			CPATH: tg.Mutation.unset(),
			LIBRARY_PATH: tg.Mutation.unset(),
			TANGRAM_LINKER_PASSTHROUGH: "1",
		},
		env_,
	];

	let result = await std.autotools.build(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			env,
			opt: "2",
			phases,
			prefixPath: "/",
			source: source_ ?? source(version),
		},
		autotools,
	);

	// Fix libc.so
	result = await applySysrootFix({
		directory: result,
		filePath: `${hostString}/lib/libc.so`,
	});

	// Fix libm.so on x86_64.
	if (host.arch === "x86_64") {
		result = await applySysrootFix({
			directory: result,
			filePath: `${hostString}/lib/libm.so`,
		});
	}

	return result;
});

type SysrootFixArg = {
	directory: tg.Directory;
	filePath: string;
};

/** Some linker scripts need a small patch to work properly with `ld`'s sysroot replacement, prepending a `=` character to paths that need to resolve relative to the sysroot rather than absolute. This target modifies the script with the given name in the given directory. */
export let applySysrootFix = async (arg: SysrootFixArg) => {
	let { directory, filePath } = arg;
	let linkerScript = tg.File.expect(await arg.directory.get(arg.filePath));
	let isElfObject =
		std.file.detectExecutableKind(await linkerScript.bytes()) === "elf";
	// If the given path points to an ELF object, don't do anything. Apply the fix if it's a text file.
	if (!isElfObject) {
		let scriptContents = await linkerScript.text();
		let scriptContentsFixed = scriptContents
			.split("\n")
			.map((line) => {
				if (line.startsWith("GROUP")) {
					return line.replace(/(\/[^ ]+)/g, "=$1");
				} else {
					return line;
				}
			})
			.join("\n");
		directory = await tg.directory(directory, {
			[filePath]: tg.file(scriptContentsFixed),
		});
	}
	return directory;
};

export let interpreterName = (system: tg.System) => {
	let arch = tg.System.arch(system);
	let soVersion = arch === "x86_64" ? "2" : "1";
	let soArch = arch === "x86_64" ? "x86-64" : arch;
	return `ld-linux-${soArch}.so.${soVersion}`;
};

let checksums: Map<GlibcVersion, tg.Checksum> = new Map([
	[
		"2.37",
		"sha256:2257eff111a1815d74f46856daaf40b019c1e553156c69d48ba0cbfc1bb91a43",
	],
	[
		"2.38",
		"sha256:fb82998998b2b29965467bc1b69d152e9c307d2cf301c9eafb4555b770ef3fd2",
	],
]);
