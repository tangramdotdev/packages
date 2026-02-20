import * as std from "std" with { local: "./std" };
import * as linux from "linux" with { local: "./linux.tg.ts" };
import python from "python" with { local: "./python" };
import texinfo from "texinfo" with { local: "./texinfo.tg.ts" };

export const metadata = {
	homepage: "https://sourceware.org/glibc/",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "LGPL-2.1-or-later",
	name: "glibc",
	repository: "https://sourceware.org/git/?p=glibc.git",
	version: "2.41",
	tag: "glibc/2.41",
	provides: {
		libraries: ["c"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:a5a26b22f545d6b7d7b3dd828e11e428f24f4fac43c934fb071b6a7d0828e901";
	return std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});
};

export type Arg = std.autotools.Arg & {
	linuxHeaders?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg({ source: source() }, ...args);
	const { host, build } = arg;
	std.assert.supportedHost(host, metadata);
	// Extract linuxHeaders from raw args since std.autotools.arg doesn't know about it.
	const headersArg = (await Promise.all(args.map(tg.resolve))).find(
		(a): a is { linuxHeaders?: tg.Directory } =>
			a !== null && typeof a === "object" && "linuxHeaders" in a,
	);
	const linuxHeaders =
		headersArg?.linuxHeaders ?? (await linux.kernelHeaders({ host }));

	const configure = {
		args: [
			"--disable-nls",
			"--enable-fortify-source",
			"--disable-nscd",
			"--disable-werror",
			"--enable-kernel=4.14",
			tg`--with-headers=${linuxHeaders}`,
			`--build=${build}`,
			`--host=${host}`,
			"libc_cv_slibdir=/lib",
			"libc_cv_forced_unwind=yes",
			"MSGFMT=:",
		],
	};

	const install = {
		args: [tg`DESTDIR="${tg.output}"/${host}`],
	};

	const phases = {
		configure,
		install,
	};

	const deps = [python({ host: build }), texinfo({ host: build })];
	const env = std.env.arg(
		...deps,
		{
			CPATH: tg.Mutation.unset(),
			LIBRARY_PATH: tg.Mutation.unset(),
			TGLD_PASSTHROUGH: true,
		},
		arg.env,
		{ utils: false },
	);

	let result = await std.autotools.build({
		build,
		host,
		defaultCrossArgs: false,
		defaultCrossEnv: false,
		env,
		fortifySource: false,
		hardeningCFlags: false,
		opt: "3",
		phases,
		prefixPath: "/",
		sdk: arg.sdk,
		source: arg.source,
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
};

export default build;

type SysrootFixArg = {
	directory: tg.Directory;
	filePath: string;
};

export type LibCArg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
	linuxHeaders?: tg.Directory;
};

/** Construct a sysroot containing the libc and the linux headers. */
export const sysroot = async (unresolvedArg?: tg.Unresolved<LibCArg>) => {
	const arg =
		unresolvedArg !== undefined ? await tg.resolve(unresolvedArg) : {};
	const host = arg.host ?? std.triple.host();
	const strippedHost = std.triple.stripVersions(host);
	const linuxHeaders =
		arg.linuxHeaders ??
		(await linux.kernelHeaders({ ...arg, host: strippedHost }));
	const cLibrary = await build({ ...arg, linuxHeaders });
	const cLibInclude = await cLibrary
		.get(`${strippedHost}/include`)
		.then(tg.Directory.expect);
	return tg.directory(cLibrary, {
		[`${host}/include`]: tg.directory(cLibInclude, linuxHeaders),
	});
};

/** Some linker scripts need a small patch to work properly with `ld`'s sysroot replacement, prepending a `=` character to paths that need to resolve relative to the sysroot rather than absolute. This target modifies the script with the given name in the given directory. */
export const applySysrootFix = async (arg: SysrootFixArg) => {
	let { directory, filePath } = arg;
	const linkerScript = await arg.directory
		.get(arg.filePath)
		.then(tg.File.expect);
	const isElfObject =
		(await std.file.detectExecutableKind(linkerScript)) === "elf";
	// If the given path points to an ELF object, don't do anything. Apply the fix if it's a text file.
	if (!isElfObject) {
		const scriptContents = await linkerScript.text;
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

export const test = async () => {
	// Use the same host triple that autotools.arg() resolves, so paths match the DESTDIR output.
	const host = std.triple.host();
	const directory = await build();
	await std.assert.nonEmpty(directory);
	// The glibc build installs under ${host}/ via DESTDIR. Verify the key files exist.
	await std.assert.fileExists({
		directory,
		subpath: `${host}/lib/libc.so`,
	});
	await std.assert.fileExists({
		directory,
		subpath: `${host}/lib/libc.a`,
	});
	return directory;
};
