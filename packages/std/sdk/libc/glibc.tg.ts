import * as std from "../../tangram.ts";

// Define supported versions.
type GlibcVersion = "2.37" | "2.38" | "2.39" | "2.40";
export const AllGlibcVersions = ["2.37", "2.38", "2.39", "2.40"];
export const defaultGlibcVersion: GlibcVersion = "2.39";

export const metadata = {
	homepage: "https://www.gnu.org/software/libc/",
	name: "glibc",
};

export const source = tg.command((version?: GlibcVersion) => {
	const { name } = metadata;
	const version_ = version ?? defaultGlibcVersion;

	const checksum = checksums.get(version_);
	tg.assert(checksum, `Unsupported glibc version ${version}`);

	return std.download.fromGnu({
		name,
		version: version_,
		compression: "xz",
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
};

export const build = tg.command(async (arg: Arg) => {
	const {
		build: build_,
		env: env_,
		host: host_,
		linuxHeaders,
		sdk,
		source: source_,
	} = arg;
	const incomingHost = host_ ?? (await std.triple.host());
	const { host, version } = splitVersionFromHost(incomingHost);
	const build = build_ ?? host;

	const additionalFlags = [];

	// The 2.38 includes the deprecated libcrypt, which is disabled by default. We opt-in to enable it.
	if (version === "2.38") {
		// libcrypt is now disabled by default, with a note that applications should prepare to migrate to new libcrypt providers like libxcrypt. GCC still expects libcrypt, so we opt-in. This may change in future iterations.
		additionalFlags.push("--enable-crypt");
	}

	if (version === "2.38" || version === "2.39" || version === "2.40") {
		// This flag is not available in previous versions. The `-DFORTIFY_SOURCE` macro was already available to users of glibc. This flag additionally uses this macro to build libc itself. It's used to detect buffer overflows at compile time.
		additionalFlags.push("--enable-fortify-source");
	}

	const configure = {
		args: [
			"--disable-nls",
			"--disable-nscd",
			"--disable-werror",
			`--enable-kernel=4.19`,
			tg`--with-headers="${linuxHeaders}/include"`,
			`--build=${build}`,
			`--host=${host}`,
			"libc_cv_slibdir=/lib",
			"libc_cv_forced_unwind=yes",
			...additionalFlags,
		],
	};

	const install = {
		args: [`DESTDIR="$OUTPUT/${host}"`],
	};

	const phases = {
		configure,
		install,
	};

	const env: tg.Unresolved<Array<std.env.Arg>> = [env_];

	env.push({
		CPATH: tg.Mutation.unset(),
		LIBRARY_PATH: tg.Mutation.unset(),
		TANGRAM_LINKER_PASSTHROUGH: true,
	});

	let result = await std.autotools.build({
		...(await std.triple.rotate({ build, host })),
		defaultCrossArgs: false,
		defaultCrossEnv: false,
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

export default build;

type SysrootFixArg = {
	directory: tg.Directory;
	filePath: string;
};

/** Some linker scripts need a small patch to work properly with `ld`'s sysroot replacement, prepending a `=` character to paths that need to resolve relative to the sysroot rather than absolute. This target modifies the script with the given name in the given directory. */
export const applySysrootFix = async (arg: SysrootFixArg) => {
	let { directory, filePath } = arg;
	const linkerScript = tg.File.expect(await arg.directory.get(arg.filePath));
	const isElfObject =
		std.file.detectExecutableKind(await linkerScript.bytes()) === "elf";
	// If the given path points to an ELF object, don't do anything. Apply the fix if it's a text file.
	if (!isElfObject) {
		const scriptContents = await linkerScript.text();
		const scriptContentsFixed = scriptContents
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

export const interpreterName = (triple: string) => {
	const arch = std.triple.arch(triple);
	const soVersion = arch === "x86_64" ? "2" : "1";
	const soArch = arch === "x86_64" ? "x86-64" : arch;
	return `ld-linux-${soArch}.so.${soVersion}`;
};

const splitVersionFromHost = (
	host: string,
): { host: string; version: GlibcVersion } => {
	const environmentVersion = std.triple.environmentVersion(host);
	if (environmentVersion) {
		tg.assert(
			AllGlibcVersions.includes(environmentVersion),
			`Unsupported glibc version ${environmentVersion}`,
		);
		return {
			host: std.triple.stripVersions(host),
			version: environmentVersion as GlibcVersion,
		};
	} else {
		return { host, version: defaultGlibcVersion };
	}
};

const checksums: Map<GlibcVersion, tg.Checksum> = new Map([
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
	[
		"2.40",
		"sha256:19a890175e9263d748f627993de6f4b1af9cd21e03f080e4bfb3a1fac10205a2",
	],
]);
