import * as std from "./tangram.ts";
import * as bootstrap from "./bootstrap.tg.ts";
import {
	type ElfExecutableMetadata,
	elfExecutableMetadata,
} from "./file/elf.tg.ts";
import {
	type MachOExecutableMetadata,
	machoExecutableMetadata,
} from "./file/macho.tg.ts";
import {
	type ShebangExecutableMetadata,
	shebangExecutableMetadata,
} from "./file/shebang.tg.ts";
import { interpreterName, interpreterPath } from "./sdk/libc.tg.ts";

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

export async function detectExecutableKind(
	file: tg.File,
): Promise<ExecutableKind> {
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
	if ((magic & 0xffff0000) === 0x23210000) {
		return "shebang";
	}
	return "unknown";
}

/** Attempt to get executable metadata. Returns undefined if unable. */
export async function tryExecutableMetadata(
	file: tg.File,
): Promise<ExecutableMetadata | undefined> {
	try {
		const metadata = await executableMetadata(file);
		return metadata;
	} catch (_) {
		return undefined;
	}
}

/** Get metadata from an executable. */
export async function executableMetadata(
	file: tg.File,
): Promise<ExecutableMetadata> {
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
}

/** Attempt to determine the hosts an executable is able to run on. */
export async function executableTriples(
	file: tg.File,
): Promise<Array<string> | undefined> {
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
}

/** Extract a native executable, validate its system libraries, and remove its artifact dependencies. */
export async function standalone(
	file: tg.File,
	host: string,
): Promise<tg.File> {
	const manifest = await std.wrap.Manifest.read(file);
	if (manifest !== undefined) {
		const references = new Map(
			(await file.dependencyObjects).map((object) => [object.id, object]),
		);
		const env = await std.wrap.envObjectFromManifestEnv(
			manifest.env,
			references,
		);
		tg.assert(
			Object.keys(env).length === 0 && (manifest.args?.length ?? 0) === 0,
			"a standalone executable cannot require wrapper arguments or environment",
		);
		const interpreter = await std.wrap.interpreterFromManifestInterpreter(
			manifest.interpreter,
			references,
		);
		if (interpreter !== undefined) {
			tg.assert(
				interpreter.kind !== "normal" &&
					(!("args" in interpreter) || (interpreter.args?.length ?? 0) === 0),
				"a standalone executable cannot require a custom interpreter or interpreter arguments",
			);

			// Allow Tangram's injection library for the build-time wrapper.
			for (const preload of interpreter.preloads ?? []) {
				const file = tg.File.expect(
					preload instanceof tg.Symlink ? await preload.resolve() : preload,
				);
				const metadata = await executableMetadata(file);
				const name =
					metadata.format === "elf"
						? metadata.soname
						: metadata.format === "mach-o"
							? metadata.installName
							: undefined;
				const match = name?.match(/^tangram-injection-(.+)\.(?:so|dylib)$/);
				tg.assert(
					match?.[1] !== undefined &&
						std.sdk.canonicalTriple(match[1]) === std.sdk.canonicalTriple(host),
					"a standalone executable cannot require a custom preload",
				);
			}
		}
		const executable = await std.wrap.executableFromManifestExecutable(
			manifest.executable,
			references,
		);
		file = tg.File.expect(
			executable instanceof tg.Symlink
				? await executable.resolve()
				: executable,
		);
		return standalone(file, host);
	}
	const metadata = await executableMetadata(file);
	let dependencies: Array<string>;
	if (metadata.format === "mach-o") {
		tg.assert(std.triple.os(host) === "darwin");
		tg.assert(metadata.arches.includes(std.triple.arch(host)));
		dependencies = (metadata.dependencies ?? []).filter(
			(path) =>
				!path.startsWith("/usr/lib/") && !path.startsWith("/System/Library/"),
		);
	} else if (metadata.format === "elf") {
		tg.assert(std.triple.os(host) === "linux");
		tg.assert(metadata.arch === std.triple.arch(host));
		tg.assert(
			metadata.interpreter === undefined ||
				metadata.interpreter === interpreterPath(host),
			"the standalone executable must use the system dynamic linker",
		);
		const libraries = new Set([
			interpreterName(host),
			"libc.so",
			"libc.so.6",
			"libdl.so.2",
			"libgcc_s.so.1",
			"libm.so.6",
			"libpthread.so.0",
			"libresolv.so.2",
			"librt.so.1",
			"libstdc++.so.6",
		]);
		dependencies = (metadata.needed ?? []).filter(
			(name) => !libraries.has(name),
		);
	} else {
		throw new Error("the standalone output must be a native executable");
	}
	tg.assert(
		dependencies.length === 0,
		`the standalone executable requires non-system libraries: ${dependencies.join(", ")}`,
	);

	return tg.file({ contents: file.contents, executable: true });
}

export async function testStandalone() {
	const buildToolchain = await bootstrap.sdk();
	const host = bootstrap.toolchainTriple(std.triple.host());
	const os = std.triple.os(host);
	const source = await tg.directory({
		"main.c": tg.file(
			'#include <stdio.h>\nint main(void) { puts("standalone"); return 0; }\n',
		),
		"preload.c": tg.file("int custom_preload(void) { return 0; }\n"),
	});
	const output = await std
		.build(std.shBootstrap`
			mkdir -p ${tg.output}
			cc ${source}/main.c -o ${tg.output}/program
			cc -shared -fPIC ${source}/preload.c -o ${tg.output}/preload
		`)
		.env(buildToolchain, { TANGRAM_LINKER_PASSTHROUGH: true })
		.then(tg.Directory.expect);
	const program = await output.get("program").then(tg.File.expect);
	const preload = await output.get("preload").then(tg.File.expect);
	const wrapped = await std.wrap(program, { buildToolchain, host });
	const exported = await standalone(wrapped, host);
	const stdout = await std
		.build(
			std.shBootstrap`${std.wrap(exported, { buildToolchain, host })} > ${tg.output}`,
		)
		.env(buildToolchain)
		.then(tg.File.expect);
	tg.assert((await stdout.text) === "standalone\n");

	const cases: Array<[std.wrap.ArgObject, string]> = [
		[{ args: ["required"] }, "wrapper arguments or environment"],
		[{ env: { REQUIRED: "true" } }, "wrapper arguments or environment"],
		[{ preloads: [preload] }, "a custom preload"],
		[
			{ interpreter: { kind: "normal", executable: program } },
			"a custom interpreter or interpreter arguments",
		],
	];
	if (os === "linux") {
		const interpreter = await std.wrap.interpreterFromManifestInterpreter(
			(await std.wrap.Manifest.read(wrapped))?.interpreter,
			new Map(
				(await wrapped.dependencyObjects).map((object) => [object.id, object]),
			),
		);
		tg.assert(interpreter?.kind === "ld-musl");
		cases.push([
			{ interpreter: { ...interpreter, args: ["--list"] } },
			"a custom interpreter or interpreter arguments",
		]);
	}
	for (const [arg, message] of cases) {
		const wrapped = await std.wrap(program, { buildToolchain, host }, arg);
		let error: unknown;
		try {
			await standalone(wrapped, host);
		} catch (caught) {
			error = caught;
		}
		tg.assert(error instanceof Error && error.message.includes(message));
	}

	return true;
}

export async function testBinary() {
	// Set up platform details.
	const bootstrapSDK = await bootstrap.sdk();
	const host = std.triple.host();
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
	const output = await std
		.build(std.shBootstrap`
		set -x
		mkdir -p ${tg.output}
		cc -v -shared -xc ${source}/greet.c -Wl,-${dylibLinkerFlag},libgreet.${versionedDylibExt} -o ${tg.output}/libgreet.${dylibExt}
		cc -v -L${tg.output} -I${source} -lgreet -xc ${source}/main.c -o ${tg.output}/exe
	`)
		.env(bootstrapSDK, {
			TANGRAM_LINKER_PASSTHROUGH: true,
		})
		.then(tg.Directory.expect);

	// Obtain the output files.
	const libgreetFile = await output
		.get(`libgreet.${dylibExt}`)
		.then(tg.File.expect);
	console.log("libgreet file", libgreetFile.id);
	const exeFile = await output.get("exe").then(tg.File.expect);
	console.log("exe file", exeFile.id);

	// Read the metadata.
	const libgreetMetadata = await executableMetadata(libgreetFile);
	console.log("libgreet metadata", libgreetMetadata);
	const exeMetadata = await executableMetadata(exeFile);
	console.log("exe metadata", exeMetadata);

	// Assert the metadata matches expected structure.
	if (os === "darwin") {
		std.assert.assertJsonSnapshot(
			libgreetMetadata,
			`
			{
				"format": "mach-o",
				"arches": ["${arch}"],
				"installName": "libgreet.${versionedDylibExt}",
				"dependencies": ["/usr/lib/libSystem.B.dylib"]
			}
		`,
		);

		std.assert.assertJsonSnapshot(
			exeMetadata,
			`
			{
				"format": "mach-o",
				"arches": ["${arch}"],
				"dependencies": ["libgreet.${versionedDylibExt}", "/usr/lib/libSystem.B.dylib"]
			}
		`,
		);
	}

	if (os === "linux") {
		std.assert.assertJsonSnapshot(
			libgreetMetadata,
			`
			{
				"format": "elf",
				"arch": "${arch}",
				"soname": "libgreet.${versionedDylibExt}",
				"needed": ["libc.so"]
			}
		`,
		);

		std.assert.assertJsonSnapshot(
			exeMetadata,
			`
			{
				"format": "elf",
				"arch": "${arch}",
				"interpreter": "/lib/ld-musl-${arch}.so.1",
				"needed": ["libc.so", "libgreet.${versionedDylibExt}"]
			}
		`,
		);
	}

	return true;
}

export async function testShebang() {
	const file = await tg.file("#!/bin/sh\n#command\necho 'test'\n", {
		executable: true,
	});
	const metadata = await std.file.executableMetadata(file);
	std.assert.assertJsonSnapshot(
		metadata,
		`
		{
			"format": "shebang",
			"interpreter": "/bin/sh"
		}
	`,
	);
}
