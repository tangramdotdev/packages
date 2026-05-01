import * as bootstrap from "../bootstrap.tg.ts";
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

export const build = async (unresolved: tg.Unresolved<BuildArg>) => {
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
	console.log("toolchain: ", buildToolchain.id);
	let env: std.Args<std.env.Arg> = [
		{ utils: false },
		buildToolchain,
		hostToolchain,
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
			"-static",
		];
	}
	if (os === "darwin") {
		osArgs = [];
		env.push({
			SDKROOT: await bootstrap.macOsSdk(),
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
	const wrapFlags = ["-static", ...releaseArgs, ...verboseArgs];
	const objcopy = os === "linux" ? "objcopy -O binary" : "cp";
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


		# Extract the binary.
		${objcopy} ${tg.output}/wrapper.exe ${tg.output}/wrapper.bin
		echo "built wrapper.bin"
	`;

	let bin = tg
		.build(std.phases.run, {
			bootstrap: true,
			env: std.env.arg(...env),
			phases: { prepare: undefined, build: buildPhase, install: undefined },
			command: {
				host: system,
			},
			network: false,
		})
		.named("compile wrapper")
		.then(tg.Directory.expect);
	return tg.directory({ bin });
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

export const workspace = async (arg?: WorkspaceArg) => {
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
	return workspace({ host, release: true });
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
		.env(toolchain, { utils: false })
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
	const output =
		await std.build`${wrapper} --tangram-print-manifest > ${tg.output}`
			.bootstrap(true)
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
};

export const testWrapperValues = async () => {
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
	const output = await std.run`
		gcc ${source}/main.c -o main
		./main > ${tg.output}
	`
		.bootstrap(true)
		.env(
			toolchain,
			{ utils: false },
			{
				TGLD_TRACING: "tgld=trace",
				TGLD_WRAPPER_ENV_VALUE_PATH: tg`${valueFiles}/env`,
				TGLD_WRAPPER_ARG_VALUE_PATH: tg`${valueFiles}/args`,
			},
		)
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

export const testPreloadIsolation = async () => {
	const toolchain = await bootstrap.sdk();

	const sources = await tg.directory({
		"libdependency.c": dependencySource,
		"outer.c": outerSource,
		"inner.c": innerSource,
	});

	// Build everything in one shell pass so the test does not pull in the
	// full SDK. Mirrors the lightweight pattern in testCompile above.
	const built = await std.run`
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
	`
		.bootstrap(true)
		.env(toolchain, { utils: false })
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
	const output = await std.build`${wrappedOuter} ${innerExe} > ${tg.output}`
		.bootstrap(true)
		.then(tg.File.expect);

	const text = await output.text;
	tg.assert(
		text === "outerinner",
		`expected "outerinner" but got ${JSON.stringify(text)} (preload may be leaking from outer to inner)`,
	);
	return true;
};
