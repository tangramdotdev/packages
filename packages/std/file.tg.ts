import * as std from "./tangram.tg.ts";

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
	interpreter?: string;
};

export type MachOExecutableMetadata = {
	/** The executable's format. */
	format: "mach-o";

	/** The executable's architectures. */
	arches: Array<string>;
};

export type ShebangExecutableMetadata = {
	/** The executable's format. */
	format: "shebang";

	/** The executable's interpreter. */
	interpreter: string;
};

/** Get metadata from an executable. */
export let executableMetadata = async (
	file: tg.File,
): Promise<ExecutableMetadata> => {
	tg.assert(file.executable);
	let bytes = await file.bytes();
	let kind = detectExecutableKind(bytes);
	if (kind === "elf") {
		let { arch, interpreter } = elfExecutableMetadata(bytes);
		return { format: "elf", arch, interpreter };
	} else if (kind === "mach-o") {
		let { arches } = machoExecutableMetadata(bytes);
		return { format: "mach-o", arches };
	} else if (kind === "shebang") {
		let text = await file.text();
		let interpreter = text.match(/^#!\s*(\S+)/)?.[1];
		tg.assert(interpreter);
		return { format: "shebang", interpreter };
	} else {
		throw new Error("Unable to ascertain file type.");
	}
};

/** Attempt to determine the systems an executable is able to run on. */
export let executableTriples = async (
	file: tg.File,
): Promise<Array<std.triple> | undefined> => {
	let metadata = await executableMetadata(file);
	let arches: Array<string>;
	let os: std.triple.Os;
	if (metadata.format === "elf") {
		arches = [metadata.arch];
		os = "linux";
	} else if (metadata.format === "mach-o") {
		arches = metadata.arches;
		os = "darwin";
	} else {
		return undefined;
	}
	return arches.map((arch) => tg.triple({ arch, os }));
};

type ExecutableKind = "elf" | "mach-o" | "shebang" | "unknown";

export let detectExecutableKind = (bytes: Uint8Array): ExecutableKind => {
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

let elfExecutableMetadata = (
	bytes: Uint8Array,
): { arch: string; interpreter: string | undefined } => {
	let fileHeader = parseElfFileHeader(bytes);
	let arch = fileHeader.arch;

	let interpreter = undefined;
	for (let programHeader of parseElfProgramHeaders(bytes)) {
		// Find the PT_INTERP program header.
		if (programHeader.type === 0x03) {
			// Read the section from the file.
			let start = bigIntToNumber(programHeader.offset);
			let end = bigIntToNumber(programHeader.offset + programHeader.fileSize);
			let sectionBytes = bytes.slice(start, end);

			// Decode the section as a UTF-8 string.
			interpreter = tg.encoding.utf8.decode(sectionBytes);
			if (interpreter.endsWith("\0")) {
				// Trim the null terminator.
				interpreter = interpreter.slice(0, -1);
			}
		}
	}

	return { arch, interpreter };
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
let parseElfFileHeader = (bytes: Uint8Array): ElfFileHeader => {
	let data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let elfClass = data.getUint8(0x04);
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

	let elfData = data.getUint8(0x05);
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

	let elfMachine = data.getUint8(0x12);
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
	let elfFileHeader = parseElfFileHeader(bytes);
	let data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	for (let i = 0; i < elfFileHeader.programHeaderTableEntryCount; i++) {
		let offset =
			elfFileHeader.programHeaderTableOffset +
			BigInt(i) * BigInt(elfFileHeader.programHeaderTableEntrySize);
		let type = data.getUint32(
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

let MACHO_CPU_TYPE_ARM64 = 0x0100000c as const;
let MACHO_CPU_TYPE_X86_64 = 0x01000007 as const;
let MACHO_MAGIC_UNIVERSAL = [0xca, 0xfe, 0xba, 0xbe];
let MACHO_MAGIC_32_LE = [0xce, 0xfa, 0xed, 0xfe];
let MACHO_MAGIC_64_LE = [0xcf, 0xfa, 0xed, 0xfe];

let machoExecutableMetadata = (
	bytes: Uint8Array,
): { arches: Array<std.triple.Arch> } => {
	let arches: Set<std.triple.Arch> = new Set();
	let data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	// Read the arches.
	if (
		startsWithBytes(bytes, MACHO_MAGIC_32_LE) ||
		startsWithBytes(bytes, MACHO_MAGIC_64_LE)
	) {
		// Read the CPU type.
		let cpuType = data.getUint32(0x4, true);

		// Push any recognized machine types found.
		if (cpuType === MACHO_CPU_TYPE_X86_64) {
			arches.add("x86_64");
		} else if (cpuType === MACHO_CPU_TYPE_ARM64) {
			arches.add("aarch64");
		}
	} else if (startsWithBytes(bytes, MACHO_MAGIC_UNIVERSAL)) {
		// Read the number of entries.
		let n = data.getUint32(0x4);

		// Initialize the offset to the size of the universal header.
		let offset = 8;

		// Read the CPU type from each entry.
		for (let i = 0; i < n; i++) {
			// Read the CPU type.
			let cpuType = data.getInt32(offset);

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

	return { arches: Array.from(arches) };
};

/** Check if a byte array starts with the provided prefix of bytes. */
let startsWithBytes = (
	bytes: Uint8Array,
	prefix: Iterable<number>,
): boolean => {
	let prefixBytes = Uint8Array.from(prefix);
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
let bigIntToNumber = (value: bigint): number => {
	if (
		value >= BigInt(Number.MIN_SAFE_INTEGER) &&
		value <= BigInt(Number.MAX_SAFE_INTEGER)
	) {
		return Number(value);
	} else {
		throw new Error(`Value ${value} cannot be converted to a number.`);
	}
};
