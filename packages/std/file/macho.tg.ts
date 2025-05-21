export type MachOExecutableMetadata = {
	/** The executable's format. */
	format: "mach-o";

	/** The executable's architectures. */
	arches: Array<string>;

	/** Required shared libraries. */
	dependencies?: Array<string>;

	/** The install name of the library (for shared libraries) */
	installName?: string | undefined;
};

export async function machoExecutableMetadata(
	file: tg.File,
): Promise<MachOExecutableMetadata> {
	const parsed = await parse(file);
	const files = "files" in parsed ? parsed.files : [parsed];
	const arches = files.map((file) => {
		switch (file.header.cputype) {
			case CPU_TYPE_ARM64: {
				return "aarch64";
			}
			case CPU_TYPE_X86_64: {
				return "x86_64";
			}
			default: {
				throw new Error("invalid cpu type");
			}
		}
	});
	const dependencies = files
		.flatMap((file) =>
			file.loadCommands.map((command) => {
				if (command.cmd === LC_LOAD_DYLIB) {
					return (command as LoadDylibCommand).name;
				}
			}),
		)
		.filter((name) => name !== undefined);
	const installNames = files
		.flatMap((file) =>
			file.loadCommands.map((command) => {
				if (command.cmd === LC_ID_DYLIB) {
					return (command as IdDylibCommand).name;
				}
			}),
		)
		.filter((name) => name !== undefined);
	return {
		format: "mach-o",
		arches: [...new Set(arches)],
		dependencies: [...new Set(dependencies)],
		installName: installNames[0],
	};
}

export type FatFile = {
	magic: FatMagic;
	arches: Array<FatArch>;
	files: Array<File>;
};

type FatMagic =
	| typeof FAT_MAGIC
	| typeof FAT_CIGAM
	| typeof FAT_MAGIC_64
	| typeof FAT_CIGAM_64;

const FAT_MAGIC = 0xcafebabe;
const FAT_CIGAM = 0xbebafeca;
const FAT_MAGIC_64 = 0xcafebabf;
const FAT_CIGAM_64 = 0xbfbafeca;

type FatArch = FatArch32 | FatArch64;

type FatArch32 = {
	cputype: number;
	cpusubtype: number;
	offset: number;
	size: number;
	align: number;
};

type FatArch64 = {
	cputype: number;
	cpusubtype: number;
	offset: bigint;
	size: bigint;
	align: number;
	reserved: number;
};

type File = { magic: Magic; header: Header; loadCommands: Array<LoadCommand> };

type Magic = typeof MAGIC | typeof CIGAM | typeof MAGIC_64 | typeof CIGAM_64;

const MAGIC = 0xfeedface;
const CIGAM = 0xcefaedfe;
const MAGIC_64 = 0xfeedfacf;
const CIGAM_64 = 0xcffaedfe;

type Header = Header32 | Header64;

type Header32 = {
	magic: typeof MAGIC | typeof CIGAM;
	cputype: number;
	cpusubtype: number;
	filetype: number;
	ncmds: number;
	sizeofcmds: number;
	flags: number;
};

type Header64 = {
	magic: typeof MAGIC_64 | typeof CIGAM_64;
	cputype: number;
	cpusubtype: number;
	filetype: number;
	ncmds: number;
	sizeofcmds: number;
	flags: number;
	reserved: number;
};

const CPU_TYPE_ARM64 = 0x0100000c as const;
const CPU_TYPE_X86_64 = 0x01000007 as const;

type LoadCommand =
	| SegmentCommand32
	| SegmentCommand64
	| SymtabCommand
	| LoadDylibCommand
	| IdDylibCommand
	| UnknownCommand;

const LC_SEGMENT = 0x1;
const LC_SYMTAB = 0x2;
const LC_SEGMENT_64 = 0x19;
const LC_LOAD_DYLIB = 0xc;
const LC_ID_DYLIB = 0xd;

type SegmentCommand32 = {
	cmd: typeof LC_SEGMENT;
	cmdsize: number;
	segname: string;
	vmaddr: number;
	vmsize: number;
	fileoff: number;
	filesize: number;
	maxprot: number;
	initprot: number;
	nsects: number;
	flags: number;
	sections: Array<Section32>;
};

type Section32 = {
	sectname: string;
	segname: string;
	addr: number;
	size: number;
	offset: number;
	align: number;
	reloff: number;
	nreloc: number;
	flags: number;
	reserved1: number;
	reserved2: number;
};

type SegmentCommand64 = {
	cmd: typeof LC_SEGMENT_64;
	cmdsize: number;
	segname: string;
	vmaddr: bigint;
	vmsize: bigint;
	fileoff: bigint;
	filesize: bigint;
	maxprot: number;
	initprot: number;
	nsects: number;
	flags: number;
	sections: Array<Section64>;
};

type Section64 = {
	sectname: string;
	segname: string;
	addr: bigint;
	size: bigint;
	offset: number;
	align: number;
	reloff: number;
	nreloc: number;
	flags: number;
	reserved1: number;
	reserved2: number;
	reserved3: number;
};

type SymtabCommand = {
	cmd: typeof LC_SYMTAB;
	cmdsize: number;
	symoff: number;
	nsyms: number;
	stroff: number;
	strsize: number;
};

type LoadDylibCommand = {
	cmd: typeof LC_LOAD_DYLIB;
	cmdsize: number;
	name: string;
	timestamp: number;
	current_version: number;
	compatibility_version: number;
};

type IdDylibCommand = {
	cmd: typeof LC_ID_DYLIB;
	cmdsize: number;
	name: string;
	timestamp: number;
	current_version: number;
	compatibility_version: number;
};

type UnknownCommand = {
	cmd: number;
	cmdsize: number;
	payload: Uint8Array;
};

export async function parse(file: tg.File): Promise<File | FatFile> {
	const bytes = await file.read({ position: 0, length: 8 });
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	const magic = view.getUint32(0, false);
	let is64: boolean;
	switch (magic) {
		case FAT_MAGIC: {
			is64 = false;
			break;
		}
		case FAT_CIGAM: {
			is64 = false;
			break;
		}
		case FAT_MAGIC_64: {
			is64 = true;
			break;
		}
		case FAT_CIGAM_64: {
			is64 = true;
			break;
		}
		case MAGIC:
		case CIGAM:
		case MAGIC_64:
		case CIGAM_64: {
			return await parseInner(file, 0);
		}
		default: {
			throw new Error("invalid magic number");
		}
	}

	const nfat_arch = view.getUint32(4, false);

	const archesBytes = await file.read({ position: 8, length: nfat_arch * 20 });
	const archesView = new DataView(
		archesBytes.buffer,
		archesBytes.byteOffset,
		archesBytes.byteLength,
	);
	let archesOffset = 0;
	const i32 = () => {
		let value = archesView.getInt32(archesOffset, false);
		archesOffset += 4;
		return value;
	};
	const u32 = () => {
		let value = archesView.getUint32(archesOffset, false);
		archesOffset += 4;
		return value;
	};
	const u64 = () => {
		let value = archesView.getBigUint64(archesOffset, false);
		archesOffset += 8;
		return value;
	};
	const arches: Array<FatArch> = [];
	const files: Array<File> = [];
	for (let i = 0; i < nfat_arch; i++) {
		if (!is64) {
			const cputype = i32();
			const cpusubtype = i32();
			const offset = u32();
			const size = u32();
			const align = u32();
			let arch = {
				cputype,
				cpusubtype,
				offset,
				size,
				align,
			};
			arches.push(arch);
			const file_ = await parseInner(file, offset);
			files.push(file_);
		} else {
			const cputype = i32();
			const cpusubtype = i32();
			const offset = u64();
			const size = u64();
			const align = u32();
			const reserved = u32();
			let arch = {
				cputype,
				cpusubtype,
				offset,
				size,
				align,
				reserved,
			};
			arches.push(arch);
			const file_ = await parseInner(file, Number(offset));
			files.push(file_);
		}
	}

	return { magic, arches, files };
}

async function parseInner(file: tg.File, offset: number): Promise<File> {
	const headerBytes = await file.read({ position: offset, length: 32 });
	const headerView = new DataView(
		headerBytes.buffer,
		headerBytes.byteOffset,
		headerBytes.byteLength,
	);
	const magic = headerView.getUint32(0, false);
	let isLe: boolean;
	let is64: boolean;
	switch (magic) {
		case MAGIC: {
			isLe = false;
			is64 = false;
			break;
		}
		case CIGAM: {
			isLe = true;
			is64 = false;
			break;
		}
		case MAGIC_64: {
			isLe = false;
			is64 = true;
			break;
		}
		case CIGAM_64: {
			isLe = true;
			is64 = true;
			break;
		}
		default: {
			throw new Error("invalid magic number");
		}
	}
	let headerOffset = 4;
	const headerI32 = () => {
		let value = headerView.getInt32(headerOffset, isLe);
		headerOffset += 4;
		return value;
	};
	const headerU32 = () => {
		let value = headerView.getUint32(headerOffset, isLe);
		headerOffset += 4;
		return value;
	};
	const header: Header = !is64
		? {
				magic: magic as typeof MAGIC | typeof CIGAM,
				cputype: headerI32(),
				cpusubtype: headerI32(),
				filetype: headerU32(),
				ncmds: headerU32(),
				sizeofcmds: headerU32(),
				flags: headerU32(),
			}
		: {
				magic: magic as typeof MAGIC_64 | typeof CIGAM_64,
				cputype: headerI32(),
				cpusubtype: headerI32(),
				filetype: headerU32(),
				ncmds: headerU32(),
				sizeofcmds: headerU32(),
				flags: headerU32(),
				reserved: headerU32(),
			};

	const headerSize = is64 ? 32 : 28;
	const loadCommandsBytes = await file.read({
		position: offset + headerSize,
		length: header.sizeofcmds,
	});
	const loadCommandsView = new DataView(
		loadCommandsBytes.buffer,
		loadCommandsBytes.byteOffset,
		loadCommandsBytes.byteLength,
	);
	let loadCommandsOffset = 0;
	const i32 = () => {
		const value = loadCommandsView.getInt32(loadCommandsOffset, isLe);
		loadCommandsOffset += 4;
		return value;
	};
	const u32 = () => {
		const value = loadCommandsView.getUint32(loadCommandsOffset, isLe);
		loadCommandsOffset += 4;
		return value;
	};
	const u64 = () => {
		const value = loadCommandsView.getBigUint64(loadCommandsOffset, isLe);
		loadCommandsOffset += 8;
		return value;
	};
	const str = (n: number) => {
		const bytes = loadCommandsBytes.subarray(
			loadCommandsOffset,
			loadCommandsOffset + n,
		);
		const index = bytes.indexOf(0);
		const value = tg.encoding.utf8.decode(
			bytes.subarray(0, index !== -1 ? index : bytes.length),
		);
		loadCommandsOffset += n;
		return value;
	};

	const loadCommands: Array<LoadCommand> = [];
	for (let i = 0; i < header.ncmds; i++) {
		const loadCommandStart = loadCommandsOffset;
		const cmd = u32();
		const cmdsize = u32();
		const payloadStart = loadCommandsOffset;
		const payloadEnd = loadCommandStart + cmdsize;
		const payload = loadCommandsBytes.subarray(payloadStart, payloadEnd);

		let loadCommand: LoadCommand;
		switch (cmd) {
			case LC_SEGMENT: {
				const segname = str(16);
				const vmaddr = u32();
				const vmsize = u32();
				const fileoff = u32();
				const filesize = u32();
				const maxprot = i32();
				const initprot = i32();
				const nsects = u32();
				const flags = u32();
				const sections = [];
				for (let i = 0; i < nsects; i++) {
					sections.push({
						sectname: str(16),
						segname: str(16),
						addr: u32(),
						size: u32(),
						offset: u32(),
						align: u32(),
						reloff: u32(),
						nreloc: u32(),
						flags: u32(),
						reserved1: u32(),
						reserved2: u32(),
					});
				}
				loadCommand = {
					cmd,
					cmdsize,
					segname,
					vmaddr,
					vmsize,
					fileoff,
					filesize,
					maxprot,
					initprot,
					nsects,
					flags,
					sections,
				};
				break;
			}
			case LC_SEGMENT_64: {
				const segname = str(16);
				const vmaddr = u64();
				const vmsize = u64();
				const fileoff = u64();
				const filesize = u64();
				const maxprot = i32();
				const initprot = i32();
				const nsects = u32();
				const flags = u32();
				const sections = [];
				for (let i = 0; i < nsects; i++) {
					sections.push({
						sectname: str(16),
						segname: str(16),
						addr: u64(),
						size: u64(),
						offset: u32(),
						align: u32(),
						reloff: u32(),
						nreloc: u32(),
						flags: u32(),
						reserved1: u32(),
						reserved2: u32(),
						reserved3: u32(),
					});
				}
				loadCommand = {
					cmd,
					cmdsize,
					segname,
					vmaddr,
					vmsize,
					fileoff,
					filesize,
					maxprot,
					initprot,
					nsects,
					flags,
					sections,
				};
				break;
			}
			case LC_SYMTAB: {
				loadCommand = {
					cmd,
					cmdsize,
					symoff: u32(),
					nsyms: u32(),
					stroff: u32(),
					strsize: u32(),
				};
				break;
			}
			case LC_LOAD_DYLIB: {
				const nameOffset = u32();
				const timestamp = u32();
				const current_version = u32();
				const compatibility_version = u32();
				const nameStart = loadCommandStart + nameOffset;
				const nameEnd = payloadEnd;
				const nameBytes = loadCommandsBytes.subarray(nameStart, nameEnd);
				const nameIndex = nameBytes.indexOf(0);
				const nameLength = nameIndex !== -1 ? nameIndex : nameBytes.length;
				const name = tg.encoding.utf8.decode(nameBytes.subarray(0, nameLength));
				loadCommand = {
					cmd,
					cmdsize,
					name,
					timestamp,
					current_version,
					compatibility_version,
				};
				break;
			}
			case LC_ID_DYLIB: {
				const nameOffset = u32();
				const timestamp = u32();
				const current_version = u32();
				const compatibility_version = u32();
				const nameStart = loadCommandStart + nameOffset;
				const nameEnd = payloadEnd;
				const nameBytes = loadCommandsBytes.subarray(nameStart, nameEnd);
				const nameIndex = nameBytes.indexOf(0);
				const nameLength = nameIndex !== -1 ? nameIndex : nameBytes.length;
				const name = tg.encoding.utf8.decode(nameBytes.subarray(0, nameLength));
				loadCommand = {
					cmd,
					cmdsize,
					name,
					timestamp,
					current_version,
					compatibility_version,
				};
				break;
			}
			default: {
				loadCommand = { cmd, cmdsize, payload };
				break;
			}
		}
		loadCommands.push(loadCommand);
		loadCommandsOffset = payloadEnd;
	}
	return { magic, header, loadCommands };
}
