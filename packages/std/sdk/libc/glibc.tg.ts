import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.tg.ts";
import * as dependencies from "../dependencies.tg.ts";

// Define supported versions.
type GlibcVersion = "2.37" | "2.38" | "2.39";
export let defaultGlibcVersion: GlibcVersion = "2.39";

export let metadata = {
	name: "glibc",
};

export let source = tg.target((version?: GlibcVersion) => {
	let { name } = metadata;
	let version_ = version ?? defaultGlibcVersion;

	let checksum = checksums.get(version_);
	tg.assert(checksum, `Unsupported glibc version ${version}`);

	return std.download.fromGnu({
		name,
		version: version_,
		compressionFormat: "xz",
		checksum,
	});
});

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
	linuxHeaders: tg.Directory;
	version?: GlibcVersion;
};

export default tg.target(async (arg: Arg) => {
	let {
		build: build_,
		env: env_,
		host: host_,
		linuxHeaders,
		sdk,
		source: source_,
		version = defaultGlibcVersion,
	} = arg;
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let additionalFlags = [];

	// The 2.38 includes the deprecated libcrypt, which is disabled by default. We opt-in to enable it.
	if (version === "2.38") {
		// libcrypt is now disabled by default, with a note that applications should prepare to migrate to new libcrypt providers like libxcrypt. GCC still expects libcrypt, so we opt-in. This may change in future iterations.
		additionalFlags.push("--enable-crypt");
	}

	if (version === "2.38" || version === "2.39") {
		// This flag is not available in previous versions. The `-DFORTIFY_SOURCE` macro was already available to users of glibc. This flag additionally uses this macro to build libc itself. It's used to detect buffer overflows at compile time.
		additionalFlags.push("--enable-fortify-source");
	}

	let configure = {
		args: [
			"--disable-nls",
			"--disable-werror",
			"--enable-kernel=4.14",
			tg`--with-headers="${linuxHeaders}/include"`,
			`--build=${build}`,
			`--host=${host}`,
			"libc_cv_slibdir=/lib",
			"libc_cv_forced_unwind=yes",
			...additionalFlags,
		],
	};

	let install = {
		args: [`DESTDIR="$OUTPUT/${host}"`],
	};

	let phases = {
		configure,
		install,
	};

	let env: tg.Unresolved<Array<std.env.Arg>> = [env_];

	env.push({
		CC: `${host}-cc`,
		CXX: `${host}-c++`,
		CPATH: tg.Mutation.unset(),
		LIBRARY_PATH: tg.Mutation.unset(),
		TANGRAM_LINKER_PASSTHROUGH: true,
	});

	let result = await std.autotools.build({
		...std.triple.rotate({ build, host }),
		env: std.env.arg(env),
		opt: "3",
		phases,
		prefixPath: "/",
		sdk,
		source: source_ ?? source(version),
	});

	// Fix libc.so.
	result = await applySysrootFix({
		directory: result,
		filePath: `${host}/lib/libc.so`,
	});

	// Fix libm.so.
	result = await applySysrootFix({
		directory: result,
		filePath: `${host}/lib/libm.so`,
	});

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

export let interpreterName = (triple: string) => {
	let arch = std.triple.arch(triple);
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
	[
		"2.39",
		"sha256:f77bd47cf8170c57365ae7bf86696c118adb3b120d3259c64c502d3dc1e2d926",
	],
]);
