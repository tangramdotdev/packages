import * as bootstrap from "../bootstrap.tg.ts";
import * as elf from "../file/elf.tg.ts";
import * as gnu from "../sdk/gnu.tg.ts";
import * as llvm from "../sdk/llvm.tg.ts";
import * as std from "../tangram.ts";
import source from "../packages/wrapper";
import workspaceSrc from "../" with { type: "directory" };
import dependencySource from "./test/libdependency.c" with { type: "file" };
import innerSource from "./test/inner.c" with { type: "file" };
import outerSource from "./test/outer.c" with { type: "file" };

type WorkspaceArg = {
	host?: string;
	target?: string;
	release?: boolean;
	source?: tg.Directory;
	verbose?: boolean;
};

type BuildArg = {
	host?: string;
	release?: boolean;
	source: tg.Directory;
	target?: string;
	verbose?: boolean;
};

export async function build(unresolved: tg.Unresolved<BuildArg>) {
	const arg = await tg.resolve(unresolved);
	const release = arg.release ?? true;
	let host_ = arg.host ?? std.triple.host();
	const host = standardizeTriple(host_);
	let target_ = arg.target ?? host;
	const target = standardizeTriple(target_);
	const system = std.triple.archAndOs(host);
	const hostOs = std.triple.os(system);
	let verbose = arg.verbose;

	const isCross =
		std.triple.arch(host_) !== std.triple.arch(target_) ||
		std.triple.os(host_) !== std.triple.os(target_);
	let prefix = ``;
	let suffix = tg``;
	if (hostOs === "linux" && isCross) {
		prefix = `${target}-`;
	}

	// Get the appropriate toolchain directory.
	// You need a build toolchian AND a host toolchain. These may be the same.
	let buildToolchain = undefined;
	let hostToolchain = undefined;
	if (hostOs === "linux") {
		if (!isCross) {
			buildToolchain = await bootstrap.sdk.env(host_);
			host_ = bootstrap.toolchainTriple(host_);
			target_ = host_;
		} else {
			buildToolchain = await bootstrap.sdk.env(host_);
			hostToolchain = await tg
				.build(gnu.toolchain, { host: system, target })
				.named("gnu toolchain");
		}
	} else {
		if (isCross) {
			buildToolchain = await bootstrap.sdk.env(host_);
			hostToolchain = await tg
				.build(llvm.toolchain, { host, target })
				.named("llvm toolchain")
				.then(tg.Directory.expect);
			const { directory: targetDirectory } = await std.sdk.toolchainComponents({
				env: await std.env.compose(hostToolchain),
				host: host_,
			});
			suffix = tg.Template
				.raw` -target ${target} --sysroot ${targetDirectory}/${target}/sysroot`;
		} else {
			buildToolchain = await bootstrap.sdk.env(host_);
		}
	}
	let env: tg.Args<std.env.Arg> = [
		buildToolchain,
		hostToolchain ?? null,
		{
			[`AR_${tripleToEnvVar(target)}`]: `${prefix}ar`,
			[`CC_${tripleToEnvVar(target)}`]: tg`${prefix}cc${suffix}`,
			[`LD_${tripleToEnvVar(target)}`]: tg`${prefix}ld${suffix}`,
		},
	];

	// Compile the wrapper binary.
	const os = std.triple.os(target_);
	const releaseArgs = release ? ["-Os"] : [];
	const verboseArgs = verbose ? ["-v"] : [];

	let osArgs: string[] = [];
	if (os === "linux") {
		osArgs = [
			"-nolibc",
			"-nostdlib",
			"-fno-tree-loop-distribute-patterns",
			"-static-pie",
		];
	}
	if (os === "darwin") {
		osArgs = [];
		env.push({
			SDKROOT: tg`${bootstrap.macOsSdk()}/MacOSX.sdk`,
		});
	}

	const cc = tg`$CC_${tripleToEnvVar(target)}`;
	const wrapperFlags = [
		"-fno-asynchronous-unwind-tables",
		"-fno-stack-protector",
		"-ffreestanding",
		"-Werror",
		"-fPIC",
		...releaseArgs,
		...verboseArgs,
		...osArgs,
	];
	let buildPhase = tg`
		set +x

		# Create output directory.
		mkdir ${tg.output}

		# Compile the wrapper.
		${cc} ${source}/src/wrapper.c \
					-I${source}/include \
					-o ${tg.output}/wrapper.exe \
					${wrapperFlags.join(" ")}
		if [ ! -e ${tg.output}/wrapper.exe ] ; then
			echo "compile step failed"
			exit 1
		fi
		echo "built wrapper.exe"
	`;

	let bin = std.phases
		.run({
			bootstrap: true,
			env: std.env.compose(...env),
			phases: { build: buildPhase },
			host: system,
			network: false,
			processName: "compile wrapper",
		})
		.then(tg.Directory.expect);
	return tg.directory({ bin });
}

/* Ensure the passed triples are what we expect, musl on linux and standard for macOS. */
function standardizeTriple(triple: string): string {
	const components = std.triple.components(triple);
	const os = components.os;

	if (os === "darwin") {
		return std.triple.create({
			...components,
			vendor: "apple",
		});
	} else if (os === "linux") {
		return std.triple.create({
			...components,
			vendor: "unknown",
			environment: "musl",
		});
	} else {
		return tg.unreachable();
	}
}

export async function workspace(arg?: WorkspaceArg) {
	const arg_ = arg ?? {};
	const {
		target: target_,
		host: host_,
		release = true,
		source: source_,
		verbose = false,
	} = await tg.resolve(arg_);
	const host = host_ ?? std.triple.host();

	// Ensure we're only building for Linux.
	const target = target_ ?? host;

	// Get the source.
	const source: tg.Directory = source_ ? source_ : workspaceSrc;
	return build({
		host,
		verbose,
		target,
		source,
		release,
	}).then(tg.Directory.expect);
}

function tripleToEnvVar(triple: string, upcase?: boolean) {
	const allCaps = upcase ?? false;
	let result = triple.replace(/-/g, "_");
	if (allCaps) {
		result = result.toUpperCase();
	}
	return result;
}

export async function test() {
	// Detect the host triple.
	const host = std.triple.host();

	// Determine the target triple with differing architecture from the host.
	const hostArch = std.triple.arch(host);
	tg.assert(hostArch);

	// const buildToolchain = await bootstrap.sdk.env(host);
	return workspace({ host, release: true });
}

const PT_LOAD = 1;
const PT_INTERP = 3;
const ET_EXEC = 2;
const ET_DYN = 3;

type ProgramHeader = elf.File["programHeaders"][number];

const loadableSegments = (parsed: elf.File) =>
	parsed.programHeaders.filter(
		(programHeader) => programHeader.p_type === PT_LOAD,
	);

const segmentFileEnd = (segment: ProgramHeader) =>
	Number(segment.p_offset) + Number(segment.p_filesz);

/** The loadable segment whose file contents end last, which is where `wrap` puts the manifest. */
const lastLoadableSegment = (parsed: elf.File) => {
	const segments = loadableSegments(parsed);
	const last = segments.reduce<ProgramHeader | undefined>(
		(current, segment) =>
			current === undefined || segmentFileEnd(segment) > segmentFileEnd(current)
				? segment
				: current,
		undefined,
	);
	tg.assert(last !== undefined, "expected a loadable segment");
	return last;
};

export async function testCompile() {
	const toolchain = std.bootstrap.sdk();
	const source = tg.directory({
		"main.c": tg.file(`
			#include <stdio.h>
			extern char** environ;
			int main(int argc, const char** argv) {
				for (int i = 0; i < 2; i++) {
					const char* var = i ? "envp" : "argv";
					const char** s = i ? (const char**)environ : argv;
					int j = 0;
					for (; *s; s++, j++) {
						printf("%s[%d] = %s\\n", var, j, *s);
					}
				}
				return 0;
			}
		`),
	});
	return std
		.run(std.shBootstrap`
		gcc ${source}/main.c -o ${tg.output}
	`)
		.env(toolchain, {
			TANGRAM_TRACING: "true",
			TANGRAM_LINKER_TRACING: "tangram_ld_proxy=trace",
		})
		.then(tg.File.expect);
}

/** `embed` lays the wrapper's segments out by address and maps the result at an address chosen for
 * the wrapped executable, so the distances its code resolved at link time survive. Two things do
 * not survive: relocations, because nothing applies them, and writes, because the segment carrying
 * the wrapper is not writable. */
export async function testWrapperPositionIndependent() {
	const host = std.triple.host();
	if (std.triple.os(host) !== "linux") {
		return true;
	}
	const output = await workspace({ host, release: true });
	const wrapper = await output.get("bin/wrapper.exe").then(tg.File.expect);
	const parsed = await elf.parse(wrapper);
	tg.assert(
		parsed.header.e_type === ET_DYN,
		"expected the wrapper to be ET_DYN",
	);
	const entry = Number(parsed.header.e_entry);
	const segments = loadableSegments(parsed);
	const entrySegment = segments.find(
		(segment) =>
			entry >= Number(segment.p_vaddr) &&
			entry < Number(segment.p_vaddr) + Number(segment.p_filesz),
	);
	tg.assert(
		entrySegment !== undefined,
		"expected the wrapper entry point to be in a file-backed PT_LOAD",
	);
	const sized = (names: Array<string>) =>
		parsed.sectionHeaders.filter(
			(section) =>
				names.includes(section.sh_name) && Number(section.sh_size) > 0,
		);
	tg.assert(
		sized([".rel.dyn", ".rel.plt", ".rela.dyn", ".rela.plt"]).length === 0,
		"expected the wrapper to have no relocations",
	);
	tg.assert(
		sized([".data", ".bss"]).length === 0,
		"expected the wrapper to have nothing it would write to",
	);
	return true;
}

/** A static executable has no PT_INTERP for the stub segment to reuse, so the wrapper is embedded
 * alongside a new program header table. */
export async function testStatic() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		return true;
	}
	const toolchain = std.bootstrap.sdk();
	const source = tg.directory({
		"main.c": tg.file(`
			#include <stdio.h>
			int main() {
				printf("hello, world!\\n");
				return 0;
			}
		`),
	});
	const directory = await std
		.run(std.shBootstrap`
		mkdir ${tg.output}
		gcc -static -no-pie ${source}/main.c -o ${tg.output}/main
	`)
		.env(toolchain)
		.then(tg.Directory.expect);
	const executable = await directory.get("main").then(tg.File.expect);
	const parsed = await elf.parse(executable);
	tg.assert(
		parsed.header.e_type === ET_EXEC,
		"expected a static non-PIE executable",
	);
	tg.assert(
		!parsed.programHeaders.some(
			(programHeader) => programHeader.p_type === PT_INTERP,
		),
		"expected no PT_INTERP",
	);
	const loads = loadableSegments(parsed);
	for (let index = 1; index < loads.length; index++) {
		tg.assert(
			Number(loads[index - 1]!.p_vaddr) <= Number(loads[index]!.p_vaddr),
			"expected PT_LOAD entries in ascending p_vaddr order",
		);
	}

	const phoff = Number(parsed.header.e_phoff);
	const phend = phoff + parsed.header.e_phnum * parsed.header.e_phentsize;
	const stub = loads.find(
		(segment) =>
			Number(segment.p_offset) <= phoff &&
			Number(segment.p_offset) + Number(segment.p_filesz) >= phend,
	);
	tg.assert(stub !== undefined, "expected e_phoff inside the stub PT_LOAD");

	// A kernel before 5.19 reports the program header table at the load address plus e_phoff rather
	// than at the address of the segment holding it, so the stub has to sit the same distance from
	// its offset as the rest of the image for both to name the same address.
	const bias = (segment: ProgramHeader) =>
		Number(segment.p_vaddr) - Number(segment.p_offset);
	tg.assert(
		bias(stub) === bias(loads[0]!),
		"expected the stub segment at the same address-to-offset distance as the image",
	);

	const copiedHeaderOffset = phoff - parsed.header.e_ehsize;
	tg.assert(
		copiedHeaderOffset === Number(stub.p_offset),
		"expected the copied ELF header immediately before the program header table",
	);
	const [header, copiedHeader] = await Promise.all([
		executable.read({ position: 0, length: parsed.header.e_ehsize }),
		executable.read({
			position: copiedHeaderOffset,
			length: parsed.header.e_ehsize,
		}),
	]);
	tg.assert(
		header.every((byte, index) => byte === copiedHeader[index]),
		"copied ELF header does not match the patched ELF header",
	);
	const wrapperSection = parsed.sectionHeaders.find(
		(section) => section.sh_name === ".text.tg-wrapper",
	);
	const manifestSection = parsed.sectionHeaders.find(
		(section) => section.sh_name === ".note.tg-manifest",
	);
	tg.assert(wrapperSection !== undefined, "expected wrapper section");
	tg.assert(manifestSection !== undefined, "expected manifest section");
	const stubEnd = Number(stub.p_offset) + Number(stub.p_filesz);
	tg.assert(
		Number(wrapperSection.sh_offset) >= Number(stub.p_offset) &&
			Number(wrapperSection.sh_offset) + Number(wrapperSection.sh_size) <=
				stubEnd &&
			Number(manifestSection.sh_offset) >= Number(stub.p_offset) &&
			Number(manifestSection.sh_offset) + Number(manifestSection.sh_size) <=
				stubEnd,
		"expected the stub to cover the wrapper, manifest, and footer",
	);
	const entry = Number(parsed.header.e_entry);
	tg.assert(
		entry >= Number(stub.p_vaddr) &&
			entry < Number(stub.p_vaddr) + Number(stub.p_filesz),
		"expected the entry point inside the stub PT_LOAD",
	);

	const output = await std
		.run(std.shBootstrap`${executable} > ${tg.output}`)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(
		text === "hello, world!\n",
		`unexpected output ${JSON.stringify(text)}`,
	);
	return true;
}

/** Writing a manifest must preserve an existing BSS rather than extending its PT_LOAD over file
 * data. */
export async function testBssManifest() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		return true;
	}
	const toolchain = std.bootstrap.sdk();
	const source = tg.directory({
		"main.c": tg.file(`
			#include <stdint.h>
			#include <stdio.h>
			volatile uint8_t retained_uninitialized_global[65536];
			int main() {
				if (retained_uninitialized_global[0] != 0 ||
					retained_uninitialized_global[65535] != 0) {
					return 1;
				}
				retained_uninitialized_global[0] = 7;
				printf("bss manifest: ok\\n");
				return 0;
			}
		`),
	});
	const executable = await std
		.run(std.shBootstrap`gcc -static ${source}/main.c -o ${tg.output}`)
		.env(toolchain, { TGLD_PASSTHROUGH: true })
		.then(tg.File.expect);

	const original = await elf.parse(executable);
	const bssSegment = lastLoadableSegment(original);
	tg.assert(
		Number(bssSegment.p_memsz) > Number(bssSegment.p_filesz),
		"expected the final PT_LOAD to contain a BSS",
	);

	const manifest = {
		executable: {
			kind: "address" as const,
			value: Number(original.header.e_entry),
		},
	};
	const rewritten = await std.wrap.Manifest.write(
		executable,
		manifest,
		new Map(),
	);
	const readManifest = await std.wrap.Manifest.read(rewritten);
	tg.assert(
		JSON.stringify(readManifest) === JSON.stringify(manifest),
		"manifest did not round trip",
	);
	const largerManifest = {
		...manifest,
		args: [
			{
				components: [{ kind: "string" as const, value: "x".repeat(8_192) }],
			},
		],
	};
	const rewrittenAgain = await std.wrap.Manifest.write(
		rewritten,
		largerManifest,
		new Map(),
	);
	const rereadManifest = await std.wrap.Manifest.read(rewrittenAgain);
	tg.assert(rereadManifest !== undefined, "expected a replacement manifest");
	tg.assert(
		JSON.stringify(rereadManifest.executable) ===
			JSON.stringify(largerManifest.executable) &&
			rereadManifest.args?.length === 1 &&
			rereadManifest.args[0]?.components[0]?.kind === "string" &&
			rereadManifest.args[0].components[0].value.length === 8_192,
		"larger replacement manifest did not round trip",
	);

	const parsed = await elf.parse(rewrittenAgain);
	tg.assert(
		parsed.header.e_phnum === original.header.e_phnum + 1,
		"expected a new program header",
	);
	tg.assert(
		Number(parsed.header.e_shoff) % 8 === 0,
		"expected an aligned section header table",
	);
	const loads = loadableSegments(parsed);
	const preservedBss = loads.find(
		(segment) => Number(segment.p_vaddr) === Number(bssSegment.p_vaddr),
	);
	tg.assert(preservedBss !== undefined, "original BSS segment is missing");
	tg.assert(
		Number(preservedBss.p_offset) === Number(bssSegment.p_offset) &&
			Number(preservedBss.p_filesz) === Number(bssSegment.p_filesz) &&
			Number(preservedBss.p_memsz) === Number(bssSegment.p_memsz),
		"original BSS segment changed",
	);
	const manifestSegment = lastLoadableSegment(parsed);
	tg.assert(
		Number(manifestSegment.p_filesz) === Number(manifestSegment.p_memsz),
		"manifest segment unexpectedly contains a BSS",
	);

	// The relocated program header table has to keep the same address-to-offset distance as the
	// image, or a kernel before 5.19 reports it somewhere it is not.
	tg.assert(
		Number(manifestSegment.p_vaddr) - Number(manifestSegment.p_offset) ===
			Number(loads[0]!.p_vaddr) - Number(loads[0]!.p_offset),
		"expected the manifest segment at the same address-to-offset distance as the image",
	);
	const phoff = Number(parsed.header.e_phoff);
	tg.assert(
		phoff >= Number(manifestSegment.p_offset) &&
			phoff + parsed.header.e_phnum * parsed.header.e_phentsize <=
				segmentFileEnd(manifestSegment),
		"expected the program header table inside the manifest segment",
	);

	const output = await std
		.run(std.shBootstrap`${rewrittenAgain} > ${tg.output}`)
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(
		text === "bss manifest: ok\n",
		`unexpected output ${JSON.stringify(text)}`,
	);
	return true;
}

/** The wrapper reads the manifest from a segment, but `strip` repacks a file by section and only
 * keeps the segments covering allocated ones. Both the embedded and the standalone wrapper must
 * still run after being stripped. */
export async function testStripPreservesManifest() {
	if (std.triple.os(std.triple.host()) !== "linux") {
		return true;
	}
	const toolchain = std.bootstrap.sdk();
	const source = tg.directory({
		"main.c": tg.file(`
			#include <stdio.h>
			int main() {
				printf("stripped: ok\\n");
				return 0;
			}
		`),
	});
	const embedded = await std
		.run(std.shBootstrap`gcc ${source}/main.c -o ${tg.output}`)
		.env(toolchain)
		.then(tg.File.expect);
	// `merge` defaults to true, which would rewrite the manifest of the embedded wrapper instead of
	// producing a standalone one, leaving that layout untested.
	const standalone = await std.wrap(embedded, {
		buildToolchain: toolchain,
		merge: false,
	});
	const output = await std
		.run(std.shBootstrap`
			cp ${embedded} embedded
			cp ${standalone} standalone
			chmod +w embedded standalone
			strip embedded standalone
			./embedded > ${tg.output}
			./standalone >> ${tg.output}
		`)
		.env(toolchain, { TGSTRIP_PASSTHROUGH: true })
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(
		text === "stripped: ok\nstripped: ok\n",
		`unexpected output ${JSON.stringify(text)}`,
	);
	return true;
}

export async function testFull() {
	const toolchain = std.sdk();
	const source = tg.directory({
		"main.c": tg.file(`
			#include <stdio.h>
			extern char** environ;
			int main(int argc, const char** argv) {
				for (int i = 0; i < 2; i++) {
					const char* var = i ? "envp" : "argv";
					const char** s = i ? (const char**)environ : argv;
					int j = 0;
					for (; *s; s++, j++) {
						printf("%s[%d] = %s\\n", var, j, *s);
					}
				}
				return 0;
			}
		`),
	});
	let file = std.$`
		gcc ${source}/main.c -o ${tg.output}
	`
		.env(toolchain)
		.then(tg.File.expect);
	return std.wrap(file, {
		env: { CUSTOM_ENV: "true", TANGRAM_SUPPRESS_ENV: "true" },
	});
}

export async function testStrip() {
	const toolchain = std.bootstrap.sdk();
	const source = tg.directory({
		"main.c": tg.file(`
			#include <stdio.h>
			extern char** environ;
			int main(int argc, const char** argv) {
				for (int i = 0; i < 2; i++) {
					const char* var = i ? "envp" : "argv";
					const char** s = i ? (const char**)environ : argv;
					int j = 0;
					for (; *s; s++, j++) {
						printf("%s[%d] = %s\\n", var, j, *s);
					}
				}
				return 0;
			}
		`),
	});
	return std
		.run(std.shBootstrap`
		mkdir -p ${tg.output}
		gcc ${source}/main.c -o ${tg.output}/original
		echo "Compiled ${tg.output}/original"
		cp ${tg.output}/original ${tg.output}/stripped
		strip --keep-section-symbols --verbose ${tg.output}/stripped
		echo "Stripped ${tg.output}/stripped"
	`)
		.env(toolchain, {
			TANGRAM_TRACING: "true",
			TGLD_TRACING: "tgld=trace",
			TGSTRIP_TRACING: "tgstrip=trace",
		});
}

export async function testPrintManifest() {
	const toolchain = std.bootstrap.sdk();
	const source = tg.directory({
		"main.c": tg.file(`
			#include <stdio.h>
			int main() {
				printf("hello from main\\n");
				return 0;
			}
		`),
	});
	const executable = await std
		.run(std.shBootstrap`
		gcc ${source}/main.c -o ${tg.output}
	`)
		.env(toolchain)
		.then(tg.File.expect);

	const wrapper = await std.wrap(executable, {
		env: {
			HELLO: "WORLD",
		},
		args: ["--foo"],
	});
	await wrapper.store();
	const wrapperId = wrapper.id;
	console.log("testPrintManifest wrapper ID", wrapperId);

	// Run the wrapper with --tangram-print-manifest and capture stdout.
	const output = await std
		.build(std.shBootstrap`${wrapper} --tangram-print-manifest > ${tg.output}`)
		.then(tg.File.expect);
	const text = await output.text;
	console.log("manifest output", text);

	// The output should be valid JSON.
	const manifest = tg.encoding.json.decode(text);
	tg.assert(manifest, "Expected manifest to be valid JSON");

	// Verify the manifest contains an executable field.
	tg.assert(
		typeof manifest === "object" &&
			manifest !== null &&
			"executable" in manifest,
		"Expected manifest to contain an executable field",
	);

	// Verify environment mutations are present.
	tg.assert("env" in manifest, "Expected manifest to contain an env field");

	// Verify args are present.
	tg.assert("args" in manifest, "Expected manifest to contain an args field");

	return true;
}

export async function testWrapperValues() {
	const toolchain = std.bootstrap.sdk();
	const source = tg.directory({
		"main.c": tg.file(`
			#include <stdio.h>
			extern char** environ;
			int main(int argc, const char** argv) {
				for (int i = 0; i < argc; i++) {
					printf("argv[%d] = %s\\n", i, argv[i]);
				}
				for (char** e = environ; *e; e++) {
					printf("env: %s\\n", *e);
				}
				return 0;
			}
		`),
	});
	const valueFiles = tg.directory({
		env: `tg.mutation({
			"kind": "set",
			"value": {
				"CUSTOM": "custom"
			}
		})`,
		args: `[
			tg.template(["--custom"])
		]`,
	});
	const output = await std
		.run(std.shBootstrap`
		gcc ${source}/main.c -o main
		./main > ${tg.output}
	`)
		.env(toolchain, {
			TGLD_TRACING: "tgld=trace",
			TGLD_WRAPPER_ENV_VALUE_PATH: tg`${valueFiles}/env`,
			TGLD_WRAPPER_ARG_VALUE_PATH: tg`${valueFiles}/args`,
		})
		.then(tg.File.expect);
	const text = await output.text;
	tg.assert(
		text.includes("argv[1] = --custom"),
		"Expected argv[1] = --custom in output",
	);
	tg.assert(
		text.includes("env: CUSTOM=custom"),
		"Expected env: CUSTOM=custom in output",
	);
	return true;
}

export async function testModify() {
	let file = await tg.file("nothing to see here\n");
	return std.run(std.shBootstrap`
		ls -al /.tangram/store
		echo 'sandbox modification' > ${file}
		echo 'adfad' > ${tg.output}
	`);
}

export async function testPreloadIsolation() {
	const toolchain = await bootstrap.sdk();

	const sources = await tg.directory({
		"libdependency.c": dependencySource,
		"outer.c": outerSource,
		"inner.c": innerSource,
	});

	// Build everything in one shell pass so the test does not pull in the
	// full SDK. Mirrors the lightweight pattern in testCompile above.
	const built = await std
		.run(std.shBootstrap`
		mkdir -p ${tg.output}/outer-lib ${tg.output}/inner-lib

		# Two libdependency.so files with the same SONAME but different MESSAGE.
		cc -fPIC -shared -Wl,-soname,libdependency.so \
			-DMESSAGE='"outer"' ${sources}/libdependency.c \
			-o ${tg.output}/outer-lib/libdependency.so

		cc -fPIC -shared -Wl,-soname,libdependency.so \
			-DMESSAGE='"inner"' ${sources}/libdependency.c \
			-o ${tg.output}/inner-lib/libdependency.so

		# Each binary embeds an rpath to its own libdependency.so so it
		# resolves DT_NEEDED locally.
		cc ${sources}/outer.c -L${tg.output}/outer-lib -ldependency \
			-Wl,-rpath,${tg.output}/outer-lib \
			-o ${tg.output}/outer

		cc ${sources}/inner.c -L${tg.output}/inner-lib -ldependency \
			-Wl,-rpath,${tg.output}/inner-lib \
			-o ${tg.output}/inner
	`)
		.env(toolchain)
		.then(tg.Directory.expect);

	const outerExe = await built.get("outer").then(tg.File.expect);
	const innerExe = await built.get("inner").then(tg.File.expect);
	const outerLibDep = await built
		.get("outer-lib/libdependency.so")
		.then(tg.File.expect);

	// Wrap outer with the "outer" libdependency.so as a preload.
	const wrappedOuter = await std.wrap(outerExe, {
		buildToolchain: toolchain,
		preloads: [outerLibDep],
	});

	// outer prints "outer", then fork/execs inner which prints "inner".
	const output = await std
		.build(std.shBootstrap`${wrappedOuter} ${innerExe} > ${tg.output}`)
		.then(tg.File.expect);

	const text = await output.text;
	tg.assert(
		text === "outerinner",
		`expected "outerinner" but got ${JSON.stringify(text)} (preload may be leaking from outer to inner)`,
	);
	return true;
}
