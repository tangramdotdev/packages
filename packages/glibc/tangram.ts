import * as std from "std" with { path: "../std" };
import bison from "bison" with { path: "../bison" };
import * as linux from "linux" with { path: "../linux" };
import perl from "perl" with { path: "../perl" };
import python from "python" with { path: "../python" };
import texinfo from "texinfo" with { path: "../texinfo" };

export const metadata = {
	homepage: "https://sourceware.org/glibc/",
	hostPlatforms: ["aarch64-linux", "x86_64-linux"],
	license: "LGPL-2.1-or-later",
	name: "glibc",
	repository: "https://sourceware.org/git/?p=glibc.git",
	version: "2.39",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:f77bd47cf8170c57365ae7bf86696c118adb3b120d3259c64c502d3dc1e2d926";
	return std.download.fromGnu({
		name,
		version,
		compressionFormat: "xz",
		checksum,
	});
});

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	linuxHeaders?: tg.Directory;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build: build_,
		env: env_,
		host: host_,
		linuxHeaders: linuxHeaders_,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(args ?? {});
	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;
	std.assert.supportedHost(host, metadata);
	const linuxHeaders = linuxHeaders_ ?? (await linux.kernelHeaders({ host }));

	const configure = {
		args: [
			"--disable-nls",
			"--enable-fortify-source",
			"--enable-kernel=4.14",
			tg`--with-headers=${linuxHeaders}`,
			`--build=${build}`,
			`--host=${host}`,
			"libc_cv_slibdir=/lib",
			"libc_cv_forced_unwind=yes",
		],
	};

	const install = {
		args: [`DESTDIR="$OUTPUT"`],
	};

	const phases = {
		configure,
		install,
	};

	const deps = [
		bison({ host: build }),
		perl({ host: build }),
		python({ host: build }),
		texinfo({ host: build }),
	];
	const env = std.env.arg(
		...deps,
		{
			CPATH: tg.Mutation.unset(),
			LIBRARY_PATH: tg.Mutation.unset(),
			TANGRAM_LINKER_PASSTHROUGH: "1",
		},
		env_,
	);

	let result = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			opt: "2",
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
		filePath: `lib/libc.so`,
	});

	// Fix libm.so.
	result = await applySysrootFix({
		directory: result,
		filePath: `lib/libm.so`,
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

export const provides = {
	libraries: ["c"],
};

export const test = tg.target(async () => {
	const spec = std.assert.defaultSpec(provides, metadata);
	return await std.assert.pkg(build, spec);
});
