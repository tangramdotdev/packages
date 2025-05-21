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
	needed?: Array<string> | undefined;
};

export const elfExecutableMetadata = async (
	file: tg.File,
): Promise<ElfExecutableMetadata> => {
	const parsed = await parse(file);
	let isLittleEndian = parsed.header.ei_data === DATA_LE;

	let arch;
	switch (parsed.header.e_machine) {
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
	
	let interpreter;
	for (const programHeader of parsed.programHeaders) {
		if (programHeader.p_type === 3) {
			const bytes = await file.read({
				position: Number(programHeader.p_offset),
				length: Number(programHeader.p_filesz),
			});
			interpreter = tg.encoding.utf8.decode(
				bytes.subarray(0, Number(programHeader.p_filesz) - 1),
			);
		}
	}
	
	let soname;
	let needed;
	for (const programHeader of parsed.programHeaders) {
		if (programHeader.p_type === 2) {
			const bytes = await file.read({
				position: Number(programHeader.p_offset),
				length: Number(programHeader.p_filesz),
			});
			const entrySize = arch === "x86_64" || arch === "aarch64" ? 16 : 8;
			const numEntries = Number(programHeader.p_filesz) / entrySize;

			// Relevant header name constants.
			const DT_NEEDED = 1;
			const DT_SONAME = 14;

			// String table constants.
			const DT_STRTAB = 5;
			const DT_STRSZ = 10;

			// First pass: Locate the string table.
			let strTabOffset = 0;
			let strTabSize = 0;
			for (let i = 0; i < numEntries; i++) {
				const entryOffset = i * entrySize;
				const tagView = new DataView(bytes.buffer, entryOffset, 8);
				const tag = tagView.getBigUint64(0, isLittleEndian);

				if (Number(tag) === DT_STRTAB) {
					const valueView = new DataView(bytes.buffer, entryOffset + 8, 8);
					strTabOffset = Number(valueView.getBigUint64(0, isLittleEndian));
				} else if (Number(tag) === DT_STRSZ) {
					const valueView = new DataView(bytes.buffer, entryOffset + 8, 8);
					strTabSize = Number(valueView.getBigUint64(0, isLittleEndian));
				}
			}

			// Read the string table.
			const strTab = await file.read({
				position: strTabOffset,
				length: strTabSize,
			});

			// Second pass: find needed libraries and soname.
			for (let i = 0; i < numEntries; i++) {
				// Find the tag.
				const entryOffset = i * entrySize;
				const tagView = new DataView(bytes.buffer, entryOffset, 8);
				const tag = tagView.getBigUint64(0, isLittleEndian);

				// Check if the tag is one we're looking for.
				if (Number(tag) === DT_NEEDED || Number(tag) === DT_SONAME) {
					const valueView = new DataView(bytes.buffer, entryOffset + 8, 8);
					const stringOffset = Number(
						valueView.getBigUint64(0, isLittleEndian),
					);

					// Determine the string size by looking for the null terminator.
					let stringEnd = stringOffset;
					while (stringEnd < strTabSize && strTab[stringEnd] !== 0) {
						stringEnd++;
					}

					const stringValue = tg.encoding.utf8.decode(
						strTab.subarray(stringOffset, stringEnd),
					);

					if (Number(tag) === DT_NEEDED) {
						if (needed === undefined) {
							needed = [stringValue];
						} else {
							needed.push(stringValue);
						}
					} else if (Number(tag) === DT_SONAME) {
						soname = stringValue;
					}
				}
			}
		}
	}

	return {
		format: "elf",
		arch,
		interpreter,
		needed,
		soname,
	};
};

export type File = {
	magic: typeof MAGIC;
	header: Header;
	programHeaders: Array<ProgramHeader>;
	sectionHeaders: Array<SectionHeader>;
};

const MAGIC = 0x7f454c46 as const;

type Class = typeof CLASS_32 | typeof CLASS_64;

const CLASS_32 = 1 as const;
const CLASS_64 = 2 as const;

type Data = typeof DATA_LE | typeof DATA_BE;

const DATA_LE = 1 as const;
const DATA_BE = 2 as const;

type Header = Header32 | Header64;

type HeaderBase = {
	ei_class: Class;
	ei_data: Data;
	ei_version: number;
	ei_osabi: number;
	ei_abiversion: number;
	e_type: number;
	e_machine: number;
	e_version: number;
	e_flags: number;
	e_ehsize: number;
	e_phentsize: number;
	e_phnum: number;
	e_shentsize: number;
	e_shnum: number;
	e_shstrndx: number;
};

type Header32 = HeaderBase & {
	ei_class: typeof CLASS_32;
	e_entry: number;
	e_phoff: number;
	e_shoff: number;
};

type Header64 = HeaderBase & {
	ei_class: typeof CLASS_64;
	e_entry: bigint;
	e_phoff: bigint;
	e_shoff: bigint;
};

type ProgramHeader = ProgramHeader32 | ProgramHeader64;

type ProgramHeader32 = {
	p_type: number;
	p_offset: number;
	p_vaddr: number;
	p_paddr: number;
	p_filesz: number;
	p_memsz: number;
	p_flags: number;
	p_align: number;
};

type ProgramHeader64 = {
	p_type: number;
	p_flags: number;
	p_offset: bigint;
	p_vaddr: bigint;
	p_paddr: bigint;
	p_filesz: bigint;
	p_memsz: bigint;
	p_align: bigint;
};

type SectionHeader = SectionHeader32 | SectionHeader64;

type SectionHeader32 = {
	sh_name: string;
	sh_type: number;
	sh_flags: number;
	sh_addr: number;
	sh_offset: number;
	sh_size: number;
	sh_link: number;
	sh_info: number;
	sh_addralign: number;
	sh_entsize: number;
};

type SectionHeader64 = {
	sh_name: string;
	sh_type: number;
	sh_flags: bigint;
	sh_addr: bigint;
	sh_offset: bigint;
	sh_size: bigint;
	sh_link: number;
	sh_info: number;
	sh_addralign: bigint;
	sh_entsize: bigint;
};

export async function parse(file: tg.File): Promise<File> {
	const headerBytes = await file.read({ position: 0, length: 64 });
	const headerView = new DataView(
		headerBytes.buffer,
		headerBytes.byteOffset,
		headerBytes.byteLength,
	);

	const magic = headerView.getUint32(0, false);
	if (magic !== MAGIC) {
		throw new Error("invalid ELF magic number");
	}

	const ei_class = headerView.getUint8(4) as Class;
	const ei_data = headerView.getUint8(5) as Data;
	const isLe = ei_data === DATA_LE;
	const is64 = ei_class === CLASS_64;
	const ei_version = headerView.getUint8(6);
	const ei_osabi = headerView.getUint8(7);
	const ei_abiversion = headerView.getUint8(8);

	let offset = 16;

	const u16 = () => {
		const value = headerView.getUint16(offset, isLe);
		offset += 2;
		return value;
	};
	const u32 = () => {
		const value = headerView.getUint32(offset, isLe);
		offset += 4;
		return value;
	};
	const u64 = () => {
		const value = headerView.getBigUint64(offset, isLe);
		offset += 8;
		return value;
	};

	const header: Header = !is64
		? {
				ei_class,
				ei_data,
				ei_version,
				ei_osabi,
				ei_abiversion,
				e_type: u16(),
				e_machine: u16(),
				e_version: u32(),
				e_entry: u32(),
				e_phoff: u32(),
				e_shoff: u32(),
				e_flags: u32(),
				e_ehsize: u16(),
				e_phentsize: u16(),
				e_phnum: u16(),
				e_shentsize: u16(),
				e_shnum: u16(),
				e_shstrndx: u16(),
			}
		: {
				ei_class,
				ei_data,
				ei_version,
				ei_osabi,
				ei_abiversion,
				e_type: u16(),
				e_machine: u16(),
				e_version: u32(),
				e_entry: u64(),
				e_phoff: u64(),
				e_shoff: u64(),
				e_flags: u32(),
				e_ehsize: u16(),
				e_phentsize: u16(),
				e_phnum: u16(),
				e_shentsize: u16(),
				e_shnum: u16(),
				e_shstrndx: u16(),
			};

	const programHeaders: Array<ProgramHeader> = [];
	const programHeaderBytes = await file.read({
		position: Number(header.e_phoff),
		length: header.e_phnum * header.e_phentsize,
	});
	const programHeadersView = new DataView(
		programHeaderBytes.buffer,
		programHeaderBytes.byteOffset,
		programHeaderBytes.byteLength,
	);

	let programHeadersOffset = 0;
	const ph_u32 = () => {
		const value = programHeadersView.getUint32(programHeadersOffset, isLe);
		programHeadersOffset += 4;
		return value;
	};
	const ph_u64 = () => {
		const value = programHeadersView.getBigUint64(programHeadersOffset, isLe);
		programHeadersOffset += 8;
		return value;
	};

	for (let i = 0; i < header.e_phnum; i++) {
		programHeadersOffset = i * header.e_phentsize;
		let programHeader: ProgramHeader;
		if (!is64) {
			programHeader = {
				p_type: ph_u32(),
				p_offset: ph_u32(),
				p_vaddr: ph_u32(),
				p_paddr: ph_u32(),
				p_filesz: ph_u32(),
				p_memsz: ph_u32(),
				p_flags: ph_u32(),
				p_align: ph_u32(),
			};
		} else {
			programHeader = {
				p_type: ph_u32(),
				p_flags: ph_u32(),
				p_offset: ph_u64(),
				p_vaddr: ph_u64(),
				p_paddr: ph_u64(),
				p_filesz: ph_u64(),
				p_memsz: ph_u64(),
				p_align: ph_u64(),
			};
		}
		programHeaders.push(programHeader);
	}

	const sectionHeaders: Array<SectionHeader> = [];
	const sectionHeadersBytes = await file.read({
		position: Number(header.e_shoff),
		length: header.e_shnum * header.e_shentsize,
	});
	const sectionHeadersView = new DataView(
		sectionHeadersBytes.buffer,
		sectionHeadersBytes.byteOffset,
		sectionHeadersBytes.byteLength,
	);

	let sectionHeadersOffset = 0;
	const sh_u32 = () => {
		const value = sectionHeadersView.getUint32(sectionHeadersOffset, isLe);
		sectionHeadersOffset += 4;
		return value;
	};
	const sh_u64 = () => {
		const value = sectionHeadersView.getBigUint64(sectionHeadersOffset, isLe);
		sectionHeadersOffset += 8;
		return value;
	};

	for (let i = 0; i < header.e_shnum; i++) {
		sectionHeadersOffset = i * header.e_shentsize;
		let sectionHeader: SectionHeader;
		if (!is64) {
			sectionHeader = {
				sh_name: sh_u32().toString(),
				sh_type: sh_u32(),
				sh_flags: sh_u32(),
				sh_addr: sh_u32(),
				sh_offset: sh_u32(),
				sh_size: sh_u32(),
				sh_link: sh_u32(),
				sh_info: sh_u32(),
				sh_addralign: sh_u32(),
				sh_entsize: sh_u32(),
			};
		} else {
			sectionHeader = {
				sh_name: sh_u32().toString(),
				sh_type: sh_u32(),
				sh_flags: sh_u64(),
				sh_addr: sh_u64(),
				sh_offset: sh_u64(),
				sh_size: sh_u64(),
				sh_link: sh_u32(),
				sh_info: sh_u32(),
				sh_addralign: sh_u64(),
				sh_entsize: sh_u64(),
			};
		}
		sectionHeaders.push(sectionHeader);
	}

	const sectionHeaderStringsHeader = sectionHeaders[header.e_shstrndx];
	if (sectionHeaderStringsHeader) {
		const sectionHeaderStringsBytes = await file.read({
			position: Number(sectionHeaderStringsHeader.sh_offset),
			length: Number(sectionHeaderStringsHeader.sh_size),
		});
		for (const sectionHeader of sectionHeaders) {
			const offset = Number(sectionHeader.sh_name);
			let end = offset;
			while (
				end < sectionHeaderStringsBytes.length &&
				sectionHeaderStringsBytes[end] !== 0
			) {
				end++;
			}
			sectionHeader.sh_name = tg.encoding.utf8.decode(
				sectionHeaderStringsBytes.subarray(offset, end),
			);
		}
	}

	return {
		magic,
		header,
		programHeaders,
		sectionHeaders,
	};
}
