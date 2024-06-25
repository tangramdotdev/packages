import * as std from "tg:std" with { path: "../std" };
import bison from "tg:bison" with { path: "../bison" };
import * as linux from "tg:linux" with { path: "../linux" };
import perl from "tg:perl" with { path: "../perl" };
import python from "tg:python" with { path: "../python" };
import texinfo from "tg:texinfo" with { path: "../texinfo" };

export let metadata = {
	homepage: "https://sourceware.org/glibc/",
	license: "LGPL-2.1-or-later",
	name: "glibc",
	repository: "https://sourceware.org/git/?p=glibc.git",
	version: "2.39",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:f77bd47cf8170c57365ae7bf86696c118adb3b120d3259c64c502d3dc1e2d926";
	return std.download.fromGnu({
		name,
		version,
		compressionFormat: "xz",
		checksum,
	});
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	linuxHeaders?: tg.Directory;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let glibc = tg.target(async (arg: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		linuxHeaders: linuxHeaders_,
		source: source_,
		...rest
	} = arg;
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;
	if (std.triple.os(host) !== "linux") {
		throw new Error("glibc is only supported on Linux");
	}
	let linuxHeaders = linuxHeaders_ ?? (await linux.kernelHeaders({ host }));

	let configure = {
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

	let install = {
		args: [`DESTDIR="$OUTPUT"`],
	};

	let phases = {
		configure,
		install,
	};

	let deps = [
		bison({ host: build }),
		perl({ host: build }),
		python({ host: build }),
		texinfo({ host: build }),
	];
	let env = [
		...deps,
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
			...(await std.triple.rotate({ build, host })),
			env,
			opt: "2",
			phases,
			prefixPath: "/",
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

export default glibc;

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
