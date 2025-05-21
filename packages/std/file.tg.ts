import * as std from "./tangram.ts";
import * as bootstrap from "./bootstrap.tg.ts";
import { ElfExecutableMetadata, elfExecutableMetadata } from "./file/elf.tg.ts";
import {
	MachOExecutableMetadata,
	machoExecutableMetadata,
} from "./file/macho.tg.ts";
import {
	ShebangExecutableMetadata,
	shebangExecutableMetadata,
} from "./file/shebang.tg.ts";

export type {
	ElfExecutableMetadata,
	MachOExecutableMetadata,
	ShebangExecutableMetadata,
};

export {
	elfExecutableMetadata,
	machoExecutableMetadata,
	shebangExecutableMetadata,
};

type ExecutableKind = "elf" | "mach-o" | "shebang" | "unknown";

export type ExecutableMetadata =
	| ElfExecutableMetadata
	| MachOExecutableMetadata
	| ShebangExecutableMetadata;

export const detectExecutableKind = async (
	file: tg.File,
): Promise<ExecutableKind> => {
	const bytes = await file.read({ length: 4 });
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const magic = view.getUint32(0, false);
	switch (magic) {
		case 0x7f454c46: {
			return "elf";
		}
		case 0xcafebabe:
		case 0xbebafeca:
		case 0xcafebabf:
		case 0xbfbafeca:
		case 0xfeedface:
		case 0xcefaedfe:
		case 0xfeedfacf:
		case 0xcffaedfe: {
			return "mach-o";
		}
	}
	if (magic & 0xff00 === 0x23210000) {
		return "shebang";
	}
	return "unknown";
};

/** Attempt to get executable metadata. Returns undefined if unable. */
export const tryExecutableMetadata = async (
	file: tg.File,
): Promise<ExecutableMetadata | undefined> => {
	try {
		const metadata = await executableMetadata(file);
		return metadata;
	} catch (_) {
		return undefined;
	}
};

/** Get metadata from an executable. */
export const executableMetadata = async (
	file: tg.File,
): Promise<ExecutableMetadata> => {
	tg.assert(file.executable);
	const kind = await detectExecutableKind(file);
	if (kind === "elf") {
		return await elfExecutableMetadata(file);
	} else if (kind === "mach-o") {
		return await machoExecutableMetadata(file);
	} else if (kind === "shebang") {
		return await shebangExecutableMetadata(file);
	} else {
		throw new Error("unable to determine the executable kind");
	}
};

/** Attempt to determine the hosts an executable is able to run on. */
export const executableTriples = async (
	file: tg.File,
): Promise<Array<string> | undefined> => {
	const metadata = await executableMetadata(file);
	let arches: Array<string>;
	let os: string;
	if (metadata.format === "elf") {
		arches = [metadata.arch];
		os = "linux";
	} else if (metadata.format === "mach-o") {
		arches = metadata.arches;
		os = "darwin";
	} else {
		return undefined;
	}
	return arches.map((arch) => std.triple.create({ arch, os }));
};

export const test = async () => {
	// Set up platform details.
	const bootstrapSDK = await bootstrap.sdk();
	const host = await std.triple.host();
	const os = std.triple.os(host);
	const arch = std.triple.arch(host);
	const dylibExt = os === "darwin" ? "dylib" : "so";
	const dylibLinkerFlag = os === "darwin" ? "install_name" : "soname";
	const versionedDylibExt = os === "darwin" ? `1.${dylibExt}` : `${dylibExt}.1`;

	// Define sources.
	const greetSource = await tg.file`
		#include <stdio.h>
		void greet() {
			printf("Hello from the shared library!\\n");
		}
	`;
	const greetHeader = await tg.file`void greet();`;

	const mainSource = await tg.file`
		#include <greet.h>
		int main() {
			greet();
			return 0;
		}
	`;
	const source = await tg.directory({
		"main.c": mainSource,
		"greet.c": greetSource,
		"greet.h": greetHeader,
	});

	// Produce a library and executable.
	const output = await std.build`
		set -x
		mkdir -p $OUTPUT
		cc -v -shared -xc ${source}/greet.c -Wl,-${dylibLinkerFlag},libgreet.${versionedDylibExt} -o $OUTPUT/libgreet.${dylibExt}
		cc -v -L$OUTPUT -I${source} -lgreet -xc ${source}/main.c -o $OUTPUT/exe
	`
		.bootstrap(true)
		.env(
			std.env.arg(
				bootstrapSDK,
				{
					TANGRAM_LINKER_PASSTHROUGH: true,
				},
				{ utils: false },
			),
		)
		.then(tg.Directory.expect);

	// Obtain the output files.
	const libgreetFile = await output
		.get(`libgreet.${dylibExt}`)
		.then(tg.File.expect);
	console.log("libgreet file", await libgreetFile.id());
	const exeFile = await output.get("exe").then(tg.File.expect);
	console.log("exe file", await exeFile.id());

	// Read the metadata.
	const libgreetMetadata = await executableMetadata(libgreetFile);
	console.log("libgreet metadata", libgreetMetadata);
	const exeMetadata = await executableMetadata(exeFile);
	console.log("exe metadata", exeMetadata);

	if (os === "darwin") {
		tg.assert(libgreetMetadata.format === "mach-o");
		tg.assert(libgreetMetadata.arches.includes(arch));
		tg.assert(libgreetMetadata.installName === `libgreet.${versionedDylibExt}`);
		tg.assert(libgreetMetadata.dependencies !== undefined);
		tg.assert(libgreetMetadata.dependencies.length === 1);
		tg.assert(
			libgreetMetadata.dependencies.includes("/usr/lib/libSystem.B.dylib"),
		);

		tg.assert(exeMetadata.format === "mach-o");
		tg.assert(exeMetadata.arches.includes(arch));
		tg.assert(exeMetadata.installName === undefined);
		tg.assert(exeMetadata.dependencies !== undefined);
		tg.assert(exeMetadata.dependencies.length === 2);
		tg.assert(exeMetadata.dependencies.includes(libgreetMetadata.installName));
		tg.assert(exeMetadata.dependencies.includes("/usr/lib/libSystem.B.dylib"));
	}

	// Assert the results.
	if (os === "linux") {
		tg.assert(libgreetMetadata.format === "elf");
		tg.assert(libgreetMetadata.arch === arch);
		tg.assert(libgreetMetadata.interpreter === undefined);
		tg.assert(libgreetMetadata.soname === `libgreet.${versionedDylibExt}`);
		tg.assert(libgreetMetadata.needed !== undefined);
		tg.assert(libgreetMetadata.needed.length === 1);
		tg.assert(libgreetMetadata.needed.includes("libc.so"));

		tg.assert(exeMetadata.format === "elf");
		tg.assert(exeMetadata.arch === arch);
		tg.assert(exeMetadata.interpreter === `/lib/ld-musl-${arch}.so.1`);
		tg.assert(exeMetadata.soname === undefined);
		tg.assert(exeMetadata.needed !== undefined);
		tg.assert(exeMetadata.needed.length === 2);
		tg.assert(exeMetadata.needed.includes("libc.so"));
		tg.assert(exeMetadata.needed.includes(libgreetMetadata.soname));
	}

	return true;
};
