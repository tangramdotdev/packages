import * as bootstrap from "../bootstrap.tg.ts";
import * as llvm from "../sdk/llvm.tg.ts";
import * as std from "../tangram.ts";
import packages from "../packages" with { type: "directory" };

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

export const workspace = async (arg: WorkspaceArg) => {
	const {
		target: target_,
		host: host_,
		release = true,
		source: source_,
		verbose = false,
	} = await tg.resolve(arg);
	const host = host_ ?? std.triple.host();

	// Ensure we're only building for Linux.
	const target = target_ ?? host;

	if (std.triple.os(target) !== "linux") {
		throw new Error("embeded wrapper support is limited to linux targets");
	}

	// Get the source.
	const source: tg.Directory = source_ ? source_ : packages;
	return build({
		host,
		verbose,
		target,
		source,
		release,
	}).then(tg.Directory.expect);
};

export const bootstrapToolchain = async (host?: string) => {
	let host_ = host ?? std.triple.host();
	return bootstrap.sdk.env(host_);
};

export const build = async (unresolved: tg.Unresolved<BuildArg>) => {
	const arg = await tg.resolve(unresolved);
	const release = arg.release ?? true;
	const source = arg.source;
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
				.build(llvm.toolchain, { host: host_, target })
				.named("llvm toolchain");
		}
	} else {
		if (isCross) {
			buildToolchain = await bootstrap.sdk.env(host_);
			hostToolchain = await tg
				.build(llvm.toolchain, { host, target })
				.named("llvm toolchain")
				.then(tg.Directory.expect);
			const { directory: targetDirectory } = await std.sdk.toolchainComponents({
				env: await std.env.arg(hostToolchain, { utils: false }),
				host: host_,
			});
			suffix = tg.Template
				.raw` -target ${target} --sysroot ${targetDirectory}/${target}/sysroot`;
		} else {
			buildToolchain = await bootstrap.sdk.env(host_);
		}
	}
	const env: std.Args<std.env.Arg> = [
		{ utils: false },
		buildToolchain,
		hostToolchain,
		{
			[`AR_${tripleToEnvVar(target)}`]: `${prefix}ar`,
			[`CC_${tripleToEnvVar(target)}`]: tg`${prefix}cc${suffix}`,
			[`LD_${tripleToEnvVar(target)}`]: tg`${prefix}ld${suffix}`,
		},
	];

	// Compile the stub binary.
	const arch = std.triple.arch(target_);
	const releaseArgs = release ? "-Os" : "";
	const verboseArgs = verbose ? "-v" : "";
	let buildPhase = tg`
		# Create output directory.
		mkdir ${tg.output}

		# Compile our sources
		$CC_${tripleToEnvVar(target)}			\
			${source}/stub/src/${arch}/start.s	\
			${source}/stub/src/stub.c			\
			${source}/stub/src/manifest.c		\
			${source}/stub/src/manifest/json.c	\
			${source}/stub/src/util.c			\
			-I${source}/stub/include			\
			-nostdlib							\
			-nolibc								\
			-ffreestanding						\
			-fno-stack-protector				\
			-static								\
			-static-libgcc						\
			-fno-asynchronous-unwind-tables		\
			-fPIC								\
			-Werror								\
			-Os									\
			-Wl,-T${source}/stub/link.ld		\
			-o ${tg.output}/stub.elf

		# Compile the stub.
		echo "compiled stub.elf"

		# Extract the binary.
		objcopy -O binary ${tg.output}/stub.elf ${tg.output}/stub.bin

		# Compile the wrap binary.
		$CC_${tripleToEnvVar(host)}		\
			${source}/stub/src/wrap.c	\
			-I${source}/stub/include	\
			-static						\
			-o ${tg.output}/wrap ${releaseArgs} ${verboseArgs}
		echo "compiled wrap"
	`;
	return await tg
		.build(std.phases.run, {
			bootstrap: true,
			env: std.env.arg(...env),
			phases: { prepare: undefined, build: buildPhase, install: undefined },
			command: {
				host: system,
			},
			network: false,
		})
		.named("stub build");
};

/* Ensure the passed triples are what we expect, musl on linux and standard for macOS. */
const standardizeTriple = (triple: string): string => {
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
};

const tripleToEnvVar = (triple: string, upcase?: boolean) => {
	const allCaps = upcase ?? false;
	let result = triple.replace(/-/g, "_");
	if (allCaps) {
		result = result.toUpperCase();
	}
	return result;
};

export const test = async () => {
	// Detect the host triple.
	const host = std.triple.host();

	// Determine the target triple with differing architecture from the host.
	const hostArch = std.triple.arch(host);
	tg.assert(hostArch);

	// const buildToolchain = await bootstrap.sdk.env(host);
	return workspace({ host });
};

export const testCompile = async () => {
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
	return std.run`
		gcc ${source}/main.c -o ${tg.output}
	`
		.bootstrap(true)
		.env(
			toolchain,
			{ utils: false },
			{
				TANGRAM_TRACING: "true",
				TANGRAM_LINKER_TRACING: "tangram_ld_proxy=trace",
			},
		)
		.then(tg.File.expect);
};

export const testFull = async () => {
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
		.env(toolchain, { utils: false }, { TANGRAM_TRACING: "true" })
		.then(tg.File.expect);
	return std.wrap(file, {
		env: { CUSTOM_ENV: "true", TANGRAM_SUPPRESS_ENV: "true" },
	});
};

export const testStrip = async () => {
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
	return std.run`
		mkdir -p ${tg.output}
		gcc ${source}/main.c -o ${tg.output}/original
		echo "Compiled ${tg.output}/original"
		cp ${tg.output}/original ${tg.output}/stripped
		strip --keep-section-symbols --verbose ${tg.output}/stripped
		echo "Stripped ${tg.output}/stripped"
	`
		.bootstrap(true)
		.env(
			toolchain,
			{ utils: false },
			{
				TANGRAM_TRACING: "true",
				TGLD_TRACING: "tgld=trace",
				TGSTRIP_TRACING: "tgstrip=trace",
			},
		);
};

export const testPrintManifest = async () => {
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
	const executable = await std.run`
		gcc ${source}/main.c -o ${tg.output}
	`
		.bootstrap(true)
		.env(toolchain, { utils: false })
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
		.build`${wrapper} --tangram-print-manifest > ${tg.output}`
		.bootstrap(true)
		.then(tg.File.expect);
	const text = await output.text;
	console.log("manifest output", text);

	// The output should be valid JSON.
	const manifest = tg.encoding.json.decode(text);
	tg.assert(manifest, "Expected manifest to be valid JSON");

	// Verify the manifest contains an executable field.
	tg.assert(
		typeof manifest === "object" && manifest !== null && "executable" in manifest,
		"Expected manifest to contain an executable field",
	);

	// Verify environment mutations are present.
	tg.assert(
		"env" in manifest,
		"Expected manifest to contain an env field",
	);

	// Verify args are present.
	tg.assert(
		"args" in manifest,
		"Expected manifest to contain an args field",
	);

	return true;
};

export const testModify = async () => {
	let file = await tg.file("nothing to see here\n");
	return std.run`
		ls -al /.tangram/artifacts
		echo 'sandbox modification' > ${file}
		echo 'adfad' > ${tg.output}
	`
		.bootstrap(true)
		.env({ utils: true });
};
