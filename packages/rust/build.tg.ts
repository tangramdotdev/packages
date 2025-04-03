import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };
import tests from "./tests" with { type: "directory" };
import { self, rustTriple } from "./tangram.ts";
import rustcProxy from "./proxy.tg.ts";

export type Arg = {
	/** The name of the crate. If not provided ,the ID of the source directory will be used. */
	crateName?: string;

	/** The type of crate to build */
	crateType?:
		| "bin"
		| "lib"
		| "rlib"
		| "dylib"
		| "cdylib"
		| "staticlib"
		| "proc-macro";

	/** Which rust edition to use */
	edition?: "2015" | "2018" | "2021" | "2024";

	/** Environment variables to set during the build */
	env?: std.env.Arg;

	/** Arbitrary cfg ooptions to set */
	cfgOptions?: Array<string>;

	/** Host to run `rustc` on */
	host?: string;

	/** Optimization level */
	optimizationLevel?: RustOptimizationLevel;

	/** Whether to enable Link Time Optimization */
	lto?: boolean | "thin" | "fat";

	/** Should rustc be proxied? Default: true. */
	proxy?: boolean;

	/** Additional flags to pass to rustc */
	rustcFlags?: Array<string>;

	/** Dependencies to include in the build */
	rustDependencies?: Array<RustDependency>;

	/** If a directory, locate either main.rs or lib.rs, and infer the crate type. If a file, must specify the crate type. */
	source: tg.Directory;

	/** Target to compile for */
	target?: string;

	/** Should we use verbose settings? Default: false */
	verbose?: boolean;
};

export type RustOptimizationLevel = "0" | "1" | "2" | "3" | "s" | "z";

export type RustDependency = {
	name: string;
	version?: string;
	cfgOptions?: Array<string>;
	/** If no path or git args are provided, source from crates.io */
	artifact?: tg.Directory;
	git?: string;
	branch?: string;
	rev?: string;
	tag?: string;
	checksum?: tg.Checksum;
};

export const build = tg.command(async (...args: std.Args<Arg>) => {
	const {
		crateName: crateName_,
		crateType: crateType_,
		edition = "2024",
		env: env_,
		cfgOptions,
		host,
		lto,
		optimizationLevel,
		proxy = true,
		rustcFlags,
		rustDependencies,
		source,
		target: target_,
		verbose = false,
	} = await std.args.apply<Arg>(args);

	const target = target_ ?? host;
	const targetPrefix = host === target ? "" : `${target}-`;
	const rustTarget = rustTriple(target);

	// Determine crate name.
	const crateName = crateName_ ?? "main";

	// Collect environments.
	const envs = [];

	// Obtain the SDK and toolchain.
	const sdk = await std.sdk({ host, target });
	envs.push(sdk);
	const rustToolchain = self({ host, target });
	envs.push(rustToolchain);

	// Find the main.rs or lib.rs file.
	let entrypoint = undefined;
	let inferredCrateType = undefined;
	for await (const [name, _artifact] of source) {
		if (name === "main.rs") {
			entrypoint = name;
			inferredCrateType = "bin";
			break;
		} else if (name === "lib.rs") {
			entrypoint = name;
			inferredCrateType = "lib";
			break;
		}
	}
	if (!entrypoint) {
		throw new Error("Could not find an entrypoint for the crate.");
	}
	const crateType = crateType_ ?? inferredCrateType;
	const outputLocation = crateType === "bin" ? "bin" : "lib";

	// Set up the proxy if requested.
	const rustcPrefix = proxy ? tg`${rustcProxy()}/bin/tangram_rustc_proxy ` : "";

	// Set the common rustc flags.
	let flags: tg.Unresolved<Array<tg.Template.Arg>> = [
		`--out-dir=$OUTPUT/${outputLocation}`,
		`--edition=${edition}`,
		`-C linker=${targetPrefix}cc`,
		`--crate-name=${crateName}`,
		`--crate-type=${crateType}`,
		`--target=${rustTarget}`,
		tg`${source}/${entrypoint}`,
	];

	// Add flags for the dependencies.
	flags = flags.concat(
		await Promise.all((rustDependencies ?? []).map(flagForDependency)),
	);

	// Add any additional rustc flags per the user options.
	if (verbose) {
		flags.push("--verbose");
	}
	if (lto) {
		flags.push(`-C lto=${lto}`);
	}
	if (optimizationLevel) {
		flags.push(`-C opt-level=${optimizationLevel}`);
	}
	if (cfgOptions) {
		flags = flags.concat(cfgOptions.map((c) => `--cfg=${c}`));
	}
	if (rustcFlags) {
		flags = flags.concat(rustcFlags.map((f) => `-C ${f}`));
	}
	const rustcCommand = tg`${rustcPrefix}rustc ${tg.Template.join(
		" ",
		...flags,
	)}`;

	// Combine the envs with the user env last.
	const env = std.env.arg(...envs, env_);

	// Run the rustc command in the source directory.
	const result = await $`${rustcCommand}`.env(env).then(tg.Directory.expect);

	return result;
});

/** Produce a --extern flag for the given dependency */
export const flagForDependency = async (
	dep: RustDependency,
): Promise<tg.Template.Arg> => {
	// Obtain the source for the dependency.
	let source = undefined;
	if (dep.artifact) {
		source = dep.artifact;
	} else if (dep.version) {
		// Obtain from crates.io.
		const checksum = dep.checksum;
		if (!checksum) {
			throw new Error("Dependency must specify a checksum.");
		}
		const url = `https://crates.io/api/v1/crates/${dep.name}/${dep.version}/download`;
		// The URL will download a `.crate` file, which is a `tar.gz` archive.
		source = await std
			.download({
				checksum,
				url,
			})
			.then(tg.Directory.expect)
			.then(std.directory.unwrap)
			.then((d) => d.get("src"))
			.then(tg.Directory.expect);
	} else if (dep.git) {
		return tg.unimplemented();
	} else {
		throw new Error(
			"Dependency must specify either artifact, version, or git.",
		);
	}
	tg.assert(source !== undefined);

	// Build the dependency.
	const builtDependency = await build({
		crateName: dep.name,
		source,
	});

	// Construct the --extern flag.
	return tg`--extern ${dep.name}=${builtDependency}/lib/lib${dep.name}.rlib`;
};

export const test = tg.command(async () => {
	const tests = [];

	tests.push(testBasicExeUnproxied());
	// tests.push(testBasicExeProxied());
	tests.push(testBasicLib());
	tests.push(testBasicExeModules());
	tests.push(testBasicExeWithLib());
	tests.push(testExeWithCratesIoDependency());
	tests.push(testConditionalCompilation());
	// tests.push(testLinkLibcurl());

	const results = await Promise.all(tests);
	tg.assert(results.every((r) => r === true));

	return true;
});

export const testBasicExeUnproxied = tg.command(async () => {
	const crateName = "native_basic_exe";
	const basicExe = await build({
		crateName,
		proxy: false,
		source: tests.get(crateName).then(tg.Directory.expect),
	});
	const basicExeOutput = await $`${crateName} | tee $OUTPUT`
		.env(basicExe)
		.then(tg.File.expect);
	const basicExeText = await basicExeOutput.text();
	tg.assert(basicExeText.trim() === "Hello, native world!");

	return true;
});

export const testBasicExeProxied = tg.command(async () => {
	const crateName = "native_basic_exe";
	const basicExe = await build({
		crateName,
		env: {
			WATERMARK: "2",
			TANGRAM_RUSTC_TRACING: "tangram=trace",
		},
		proxy: true,
		source: tests.get(crateName).then(tg.Directory.expect),
		verbose: true,
	});
	const basicExeOutput = await $`${crateName} | tee $OUTPUT`
		.env(basicExe)
		.then(tg.File.expect);
	const basicExeText = await basicExeOutput.text();
	tg.assert(basicExeText.trim() === "Hello, native world!");

	return true;
});

export const testBasicLib = tg.command(async () => {
	const crateName = "native_basic_lib";
	const basicLib = await build({
		crateName,
		source: tests.get(crateName).then(tg.Directory.expect),
	});
	const rlib = await basicLib.tryGet(`lib/lib${crateName}.rlib`);
	tg.assert(rlib !== undefined);

	return true;
});

export const testBasicExeModules = tg.command(async () => {
	const crateName = "native_basic_exe_modules";
	const basicExeModules = await build({
		crateName,
		source: tests.get(crateName).then(tg.Directory.expect),
	});
	const basicExeModulesOutput = await $`${crateName} | tee $OUTPUT`
		.env(basicExeModules)
		.then(tg.File.expect);
	const basicExeModulesText = await basicExeModulesOutput.text();
	tg.assert(basicExeModulesText.trim() === "Hello from a module!");

	return true;
});

export const testBasicExeWithLib = tg.command(async () => {
	const crateName = "native_basic_exe_with_lib";
	const depName = "native_basic_lib";
	const basicExeWithLib = await build({
		crateName,
		source: tests.get(crateName).then(tg.Directory.expect),
		rustDependencies: [
			{
				name: depName,
				artifact: tests.get(depName).then(tg.Directory.expect),
			},
		],
	});
	const basicExeWithLibOutput = await $`${crateName} | tee $OUTPUT`
		.env(basicExeWithLib)
		.then(tg.File.expect);
	const basicExeWithLibText = await basicExeWithLibOutput.text();
	tg.assert(basicExeWithLibText.trim() === "Hello from a library!");

	return true;
});

export const testExeWithCratesIoDependency = tg.command(async () => {
	const crateName = "native_deps_exe";
	const depsExe = await build({
		crateName,
		env: {
			TANGRAM_RUSTC_TRACING: "tangram=trace",
		},
		source: tests.get(crateName).then(tg.Directory.expect),
		rustDependencies: [
			{
				name: "bytes",
				version: "1.7.1",
				checksum:
					"sha256:8318a53db07bb3f8dca91a600466bdb3f2eaadeedfdbcf02e1accbad9271ba50",
			},
		],
	});
	const depsExeOutput = await $`${crateName} | tee $OUTPUT`
		.env(depsExe)
		.then(tg.File.expect);
	const depsExeText = await depsExeOutput.text();
	tg.assert(depsExeText.trim() === 'b"Hello using the bytes crate!"');
	return true;
});

export const testConditionalCompilation = tg.command(async () => {
	const crateName = "native_cfg_exe";
	// Test without the optional feature.
	const cfgDisabled = await build({
		crateName: crateName,
		source: tests.get(crateName).then(tg.Directory.expect),
	});
	const cfgDisabledOutput = await $`${crateName} | tee $OUTPUT`
		.env(cfgDisabled)
		.then(tg.File.expect);
	const cfgDisabledText = await cfgDisabledOutput.text();
	tg.assert(cfgDisabledText.trim() === "optional feature disabled");

	// Test with the optional feature.
	const cfgEnabled = await build({
		crateName,
		cfgOptions: ["optional"],
		source: tests.get(crateName).then(tg.Directory.expect),
		verbose: true,
	});
	const cfgEnabledOutput = await $`${crateName} | tee $OUTPUT`
		.env(cfgEnabled)
		.then(tg.File.expect);
	const cfgEnabledText = await cfgEnabledOutput.text();
	tg.assert(cfgEnabledText.trim() === "optional feature enabled");

	return true;
});

import * as curl from "curl" with { path: "../curl" };
import * as libpsl from "libpsl" with { path: "../libpsl" };
import * as openssl from "openssl" with { path: "../openssl" };
import * as zlib from "zlib" with { path: "../zlib" };
import * as zstd from "zstd" with { path: "../zstd" };
export const testLinkLibcurl = tg.command(async () => {
	const crateName = "native_exe_libcurl";

	// Obtain dependencies. Libcurl transitively requires libssl, libz, and libzstd.
	const libcurl = curl.build();
	const libpslArtifact = libpsl.build();
	const sslArtifact = openssl.build();
	const zlibArtifact = zlib.build();
	const zstdArtifact = zstd.build();
	const deps = [
		libcurl,
		libpslArtifact,
		sslArtifact,
		zlibArtifact,
		zstdArtifact,
	];

	// Build the test.
	const exe = await build({
		crateName,
		env: std.env.arg(...deps),
		source: tests.get(crateName).then(tg.Directory.expect),
	});
	console.log("exe", await exe.id());

	// Libcurl transitively requires libssl at runtime.
	const host = await std.triple.host();
	const os = std.triple.os(host);
	const runtimeLibVar =
		os === "darwin" ? "DYLD_FALLBACK_LIBRARY_PATH" : "LD_LIBRARY_PATH";
	const exeOutput =
		await $`export ${runtimeLibVar}=$LIBRARY_PATH\n${crateName} | tee $OUTPUT`
			.env(exe, ...deps)
			.then(tg.File.expect);
	const exeText = await exeOutput.text();
	tg.assert(exeText.trim().includes(curl.metadata.version));

	return true;
});
