import * as std from "./tangram.ts";
import * as bootstrap from "./bootstrap.tg.ts";

export type ExecutableMetadata =
	| ElfExecutableMetadata
	| MachOExecutableMetadata
	| ShebangExecutableMetadata;

export type ElfExecutableMetadata = {
	/** The executable's format. */
	format: "elf";

	/** The executable's architecture. */
	arch: string;

	/** The executable's interpreter. */
	interpreter?: string | undefined;

	/** The SONAME of the library (for shared libraries) */
	soname?: string | undefined;

	/** Required shared libraries. */
	needed?: Array<string>;
};

export type MachOExecutableMetadata = {
	/** The executable's format. */
	format: "mach-o";

	/** The executable's architectures. */
	arches: Array<string>;

	/** The install name of the library (for shared libraries) */
	installName?: string | undefined;

	/** Required shared libraries. */
	dependencies?: Array<string>;
};

export type ShebangExecutableMetadata = {
	/** The executable's format. */
	format: "shebang";

	/** The executable's interpreter. */
	interpreter: string;
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
	const bytes = await file.bytes();
	const kind = detectExecutableKind(bytes);
	if (kind === "elf") {
		const elfMetadata = elfExecutableMetadata(bytes);
		return { ...elfMetadata, format: "elf" };
	} else if (kind === "mach-o") {
		const machOMetadata = machoExecutableMetadata(bytes);
		return { ...machOMetadata, format: "mach-o" };
	} else if (kind === "shebang") {
		const text = await file.text();
		const interpreter = text.match(/^#!\s*(\S+)/)?.[1];
		tg.assert(interpreter);
		return { format: "shebang", interpreter };
	} else {
		throw new Error("Unable to ascertain file type.");
	}
};

/** Attempt to determine the systems an executable is able to run on. */
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

type ExecutableKind = "elf" | "mach-o" | "shebang" | "unknown";

export const detectExecutableKind = (bytes: Uint8Array): ExecutableKind => {
	if (startsWithBytes(bytes, [0x7f, 0x45, 0x4c, 0x46])) {
		// ELF.
		return "elf";
	} else if (startsWithBytes(bytes, MACHO_MAGIC_32_LE)) {
		// 32-bit LE Mach-O.
		return "mach-o";
	} else if (startsWithBytes(bytes, MACHO_MAGIC_64_LE)) {
		// 64-bit LE Mach-O.
		return "mach-o";
	} else if (startsWithBytes(bytes, MACHO_MAGIC_UNIVERSAL)) {
		// Universal Mach-O.
		return "mach-o";
	} else if (startsWithBytes(bytes, [0x23, 0x21])) {
		// Shebang.
		return "shebang";
	} else {
		return "unknown";
	}
};

const DT_NEEDED = 1 as const;
const DT_SONAME = 14 as const;

const elfExecutableMetadata = (
	bytes: Uint8Array,
): {
	arch: string;
	interpreter: string | undefined;
	soname: string | undefined;
	needed: Array<string>;
} => {
	const fileHeader = parseElfFileHeader(bytes);
	const arch = fileHeader.arch;
	let interpreter = undefined;
	let soname: string | undefined;
	const needed: Array<string | undefined> = [];

	for (const programHeader of Array.from(parseElfProgramHeaders(bytes))) {
		// Find the PT_INTERP program header.
		if (programHeader.type === 0x03) {
			// Read the section from the file.
			const start = bigIntToNumber(programHeader.offset);
			const end = bigIntToNumber(programHeader.offset + programHeader.fileSize);
			const sectionBytes = bytes.slice(start, end);

			// Decode the section as a UTF-8 string.
			interpreter = tg.encoding.utf8.decode(sectionBytes);
			if (interpreter.endsWith("\0")) {
				// Trim the null terminator.
				interpreter = interpreter.slice(0, -1);
			}
		}
		// Find the PT_DYNAMIC segment (type 2)
		else if (programHeader.type === 0x02) {
			const dynamicEntries = parseDynamicSection(
				bytes,
				programHeader.offset,
				programHeader.fileSize,
				fileHeader,
			);

			for (const entry of dynamicEntries) {
				if (entry.tag === DT_SONAME) {
					soname = entry.string;
				} else if (entry.tag === DT_NEEDED) {
					needed.push(entry.string);
				}
			}
		}
	}

	return {
		arch,
		interpreter,
		soname,
		needed: needed.filter((el): el is string => el !== undefined),
	};
};

type ElfFileHeader = {
	bits: 32 | 64;
	isLittleEndian: boolean;
	arch: string;
	programHeaderTableOffset: bigint;
	programHeaderTableEntrySize: number;
	programHeaderTableEntryCount: number;
};

/** Parse the file header of the bytes from an ELF file. This function throws an error if it could not be parsed. */
const parseElfFileHeader = (bytes: Uint8Array): ElfFileHeader => {
	const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const elfClass = data.getUint8(0x04);
	let bits: 32 | 64;
	switch (elfClass) {
		case 1: {
			bits = 32;
			break;
		}
		case 2: {
			bits = 64;
			break;
		}
		default: {
			throw new Error(`Invalid EI_CLASS in ELF header.`);
		}
	}

	const elfData = data.getUint8(0x05);
	let isLittleEndian: boolean;
	switch (elfData) {
		case 1: {
			isLittleEndian = true;
			break;
		}
		case 2: {
			isLittleEndian = false;
			break;
		}
		default: {
			throw new Error(`Invalid EI_DATA in ELF header.`);
		}
	}

	const elfMachine = data.getUint8(0x12);
	let arch: string | undefined;
	switch (elfMachine) {
		case 0x08: {
			arch = "mips";
			break;
		}
		case 0x28: {
			arch = "arm";
			break;
		}
		case 0x3e: {
			arch = "x86_64";
			break;
		}
		case 0xb7: {
			arch = "aarch64";
			break;
		}
		default: {
			throw new Error("Unsupported machine type.");
		}
	}

	let programHeaderTableOffset: bigint;
	switch (bits) {
		case 32:
			programHeaderTableOffset = BigInt(data.getUint32(0x1c, isLittleEndian));
			break;
		case 64:
			programHeaderTableOffset = BigInt(
				data.getBigUint64(0x20, isLittleEndian),
			);
			break;
	}

	let programHeaderTableEntrySize: number;
	switch (bits) {
		case 32:
			programHeaderTableEntrySize = data.getUint16(0x2a, isLittleEndian);
			break;
		case 64:
			programHeaderTableEntrySize = data.getUint16(0x36, isLittleEndian);
			break;
	}

	let programHeaderTableEntryCount: number;
	switch (bits) {
		case 32:
			programHeaderTableEntryCount = data.getUint16(0x2c, isLittleEndian);
			break;
		case 64:
			programHeaderTableEntryCount = data.getUint16(0x38, isLittleEndian);
			break;
	}

	return {
		bits,
		isLittleEndian,
		arch,
		programHeaderTableOffset,
		programHeaderTableEntryCount,
		programHeaderTableEntrySize,
	};
};

type ElfProgramHeader = {
	type: number;
	offset: bigint;
	fileSize: bigint;
};

function* parseElfProgramHeaders(
	bytes: Uint8Array,
): Iterable<ElfProgramHeader> {
	const elfFileHeader = parseElfFileHeader(bytes);
	const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	for (let i = 0; i < elfFileHeader.programHeaderTableEntryCount; i++) {
		const offset =
			elfFileHeader.programHeaderTableOffset +
			BigInt(i) * BigInt(elfFileHeader.programHeaderTableEntrySize);
		const type = data.getUint32(
			bigIntToNumber(offset),
			elfFileHeader.isLittleEndian,
		);

		let fileOffset: bigint;
		switch (elfFileHeader.bits) {
			case 32: {
				fileOffset = BigInt(
					data.getUint32(
						bigIntToNumber(offset + BigInt(0x04)),
						elfFileHeader.isLittleEndian,
					),
				);
				break;
			}
			case 64: {
				fileOffset = BigInt(
					data.getBigUint64(
						bigIntToNumber(offset + BigInt(0x08)),
						elfFileHeader.isLittleEndian,
					),
				);
				break;
			}
		}

		let fileSize: bigint;
		switch (elfFileHeader.bits) {
			case 32: {
				fileSize = BigInt(
					data.getUint32(
						bigIntToNumber(offset + BigInt(0x10)),
						elfFileHeader.isLittleEndian,
					),
				);
				break;
			}
			case 64: {
				fileSize = BigInt(
					data.getBigUint64(
						bigIntToNumber(offset + BigInt(0x20)),
						elfFileHeader.isLittleEndian,
					),
				);
				break;
			}
		}

		yield { type, offset: fileOffset, fileSize };
	}

	return null;
}

type ElfDynamicEntry = {
	tag: number;
	val: bigint;
	string?: string | undefined;
};

function* parseDynamicSection(
	bytes: Uint8Array,
	offset: bigint,
	size: bigint,
	fileHeader: ElfFileHeader,
): Iterable<ElfDynamicEntry> {
	const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const start = bigIntToNumber(offset);
	const end = bigIntToNumber(offset + size);

	// First pass: collect string table offset
	let strTabOffset = BigInt(0);
	for (let i = start; i < end; i += fileHeader.bits === 32 ? 8 : 16) {
		const tag =
			fileHeader.bits === 32
				? data.getInt32(i, fileHeader.isLittleEndian)
				: Number(data.getBigInt64(i, fileHeader.isLittleEndian));

		const val =
			fileHeader.bits === 32
				? BigInt(data.getUint32(i + 4, fileHeader.isLittleEndian))
				: data.getBigInt64(i + 8, fileHeader.isLittleEndian);

		if (tag === 5) {
			// DT_STRTAB
			strTabOffset = val;
			break;
		}
	}

	// Second pass: yield entries with resolved strings
	for (let i = start; i < end; i += fileHeader.bits === 32 ? 8 : 16) {
		const tag =
			fileHeader.bits === 32
				? data.getInt32(i, fileHeader.isLittleEndian)
				: Number(data.getBigInt64(i, fileHeader.isLittleEndian));

		const val =
			fileHeader.bits === 32
				? BigInt(data.getUint32(i + 4, fileHeader.isLittleEndian))
				: data.getBigInt64(i + 8, fileHeader.isLittleEndian);

		if (tag === 0) break; // DT_NULL

		const entry: ElfDynamicEntry = { tag, val };

		// For NEEDED and SONAME, resolve the string
		if (tag === DT_NEEDED || tag === DT_SONAME) {
			try {
				entry.string = readNullTerminatedString(
					bytes,
					bigIntToNumber(strTabOffset + val),
				);
			} catch (_) {}
		}

		yield entry;
	}
}

const LC_ID_DYLIB = 0x0000000d as const;
const LC_LOAD_DYLIB = 0x0000000c as const;
const MACHO_CPU_TYPE_ARM64 = 0x0100000c as const;
const MACHO_CPU_TYPE_X86_64 = 0x01000007 as const;
const MACHO_MAGIC_UNIVERSAL = [0xca, 0xfe, 0xba, 0xbe];
const MACHO_MAGIC_32_LE = [0xce, 0xfa, 0xed, 0xfe];
const MACHO_MAGIC_64_LE = [0xcf, 0xfa, 0xed, 0xfe];

const machoExecutableMetadata = (
	bytes: Uint8Array,
): {
	arches: Array<string>;
	installName?: string | undefined;
	dependencies: Array<string>;
} => {
	const arches: Set<string> = new Set();
	const dependencies: Array<string> = [];
	let installName: string | undefined;
	const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	// Read the arches.
	if (
		startsWithBytes(bytes, MACHO_MAGIC_32_LE) ||
		startsWithBytes(bytes, MACHO_MAGIC_64_LE)
	) {
		// Read the CPU type.
		const is64 = startsWithBytes(bytes, MACHO_MAGIC_64_LE);
		const cpuType = data.getUint32(0x4, true);

		// Push any recognized machine types found.
		if (cpuType === MACHO_CPU_TYPE_X86_64) {
			arches.add("x86_64");
		} else if (cpuType === MACHO_CPU_TYPE_ARM64) {
			arches.add("aarch64");
		}

		// Parse load commands
		const ncmds = data.getUint32(0x10, true);
		let offset = is64 ? 0x20 : 0x1c;

		for (let i = 0; i < ncmds; i++) {
			const cmd = data.getUint32(offset, true);
			const cmdsize = data.getUint32(offset + 4, true);

			if (cmd === LC_ID_DYLIB || cmd === LC_LOAD_DYLIB) {
				const nameOffset = data.getUint32(offset + 8, true);
				const name = readNullTerminatedString(bytes, offset + nameOffset);

				if (cmd === LC_ID_DYLIB) {
					installName = name;
				} else {
					dependencies.push(name);
				}
			}

			offset += cmdsize;
		}
	} else if (startsWithBytes(bytes, MACHO_MAGIC_UNIVERSAL)) {
		// Read the number of entries.
		const n = data.getUint32(0x4);

		// Initialize the offset to the size of the universal header.
		let offset = 8;

		// Read the CPU type from each entry.
		for (let i = 0; i < n; i++) {
			// Read the CPU type.
			const cpuType = data.getInt32(offset);

			// Push any recognized machine types found.
			if (cpuType === MACHO_CPU_TYPE_X86_64) {
				arches.add("x86_64");
			} else if (cpuType === MACHO_CPU_TYPE_ARM64) {
				arches.add("aarch64");
			}

			// Advance the pointer by the size of the universal file entry.
			offset += 20;
		}
	}

	return { arches: Array.from(arches), installName, dependencies };
};

/** Check if a byte array starts with the provided prefix of bytes. */
const startsWithBytes = (
	bytes: Uint8Array,
	prefix: Iterable<number>,
): boolean => {
	const prefixBytes = Uint8Array.from(prefix);
	if (bytes.length < prefixBytes.length) {
		return false;
	}
	for (let i = 0; i < prefixBytes.length; i++) {
		if (bytes[i] !== prefixBytes[i]) {
			return false;
		}
	}
	return true;
};

/** Convert a BigInt value to a number, or throw an error if cannot be converted losslessly. */
const bigIntToNumber = (value: bigint): number => {
	if (
		value >= BigInt(Number.MIN_SAFE_INTEGER) &&
		value <= BigInt(Number.MAX_SAFE_INTEGER)
	) {
		return Number(value);
	} else {
		throw new Error(`Value ${value} cannot be converted to a number.`);
	}
};

/** Read a null-terminated C-string into a JS string. */
const readNullTerminatedString = (
	bytes: Uint8Array,
	offset: number,
): string => {
	let end = offset;
	while (end < bytes.length && bytes[end] !== 0) {
		end++;
	}
	const slice = bytes.slice(offset, end);
	return tg.encoding.utf8.decode(slice);
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
		}`;
	const greetHeader = await tg.file`void greet();`;

	const mainSource = await tg.file`
		#include <greet.h>
		int main() {
			greet();
			return 0;
		}`;
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

	return true;
};
