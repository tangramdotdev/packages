import * as std from "std" with { local: "../std" };
import * as linux from "linux" with { local: "../linux" };
import python from "python" with { local: "../python" };
import texinfo from "texinfo" with { local: "../texinfo" };

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

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	linuxHeaders?: tg.Directory;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build: build_,
		env: env_,
		host: host_,
		linuxHeaders: linuxHeaders_,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;
	std.assert.supportedHost(host, metadata);
	const linuxHeaders = linuxHeaders_ ?? (await linux.kernelHeaders({ host }));

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
		],
	};

	const install = {
		args: [`DESTDIR="$OUTPUT"/${host}`],
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
		env_,
	);

	let result = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			fortifySource: false,
			hardeningCFlags: false,
			opt: "3",
			phases,
			prefixPath: "/",
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

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
	const host = arg.host ?? (await std.triple.host());
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

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
