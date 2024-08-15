import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };
import tests from "./tests" with { type: "directory" };
import { toolchain, rustTriple } from "./tangram.tg.ts";
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
	edition?: "2015" | "2018" | "2021";

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

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		crateName: crateName_,
		crateType: crateType_,
		edition = "2021",
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

	let target = target_ ?? host;
	let targetPrefix = host === target ? "" : `${target}-`;
	let rustTarget = rustTriple(target);

	// Determine crate name.
	let crateName = crateName_ ?? (await source.id());

	// Collect environments.
	let envs = [];

	// Obtain the SDK and toolchain.
	let sdk = await std.sdk({ host, target });
	envs.push(sdk);
	let rustToolchain = toolchain({ host, target });
	envs.push(rustToolchain);

	// Find the main.rs or lib.rs file.
	let entrypoint = undefined;
	let inferredCrateType = undefined;
	for await (let [name, _artifact] of source) {
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
	let crateType = crateType_ ?? inferredCrateType;
	let outputLocation = crateType === "bin" ? "bin" : "lib";

	// Set up the proxy if requested.
	let rustcPrefix = proxy ? tg`${rustcProxy()}/bin/tangram_rustc ` : "";

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
	let rustcCommand = tg`${rustcPrefix}rustc ${tg.Template.join(" ", ...flags)}`;

	// Combine the envs with the user env last.
	let env = std.env.arg(...envs, env_);

	// Run the rustc command in the source directory.
	let result = await $`${rustcCommand}`.env(env).then(tg.Directory.expect);

	return result;
});

/** Produce a --extern flag for the given dependency */
export let flagForDependency = async (
	dep: RustDependency,
): Promise<tg.Template.Arg> => {
	// Obtain the source for the dependency.
	let source = undefined;
	if (dep.artifact) {
		source = dep.artifact;
	} else if (dep.version) {
		// Obtain from crates.io.
		let checksum = dep.checksum;
		if (!checksum) {
			throw new Error("Dependency must specify a checksum.");
		}
		let url = `https://crates.io/api/v1/crates/${dep.name}/${dep.version}/download`;
		// The URL will download a `.crate` file, which is a `tar.gz` archive.
		source = await std
			.download({
				checksum,
				decompress: "gz",
				extract: "tar",
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
	let builtDependency = await build({
		crateName: dep.name,
		source,
	});

	// Construct the --extern flag.
	return tg`--extern ${dep.name}=${builtDependency}/lib/lib${dep.name}.rlib`;
};

export let test = tg.target(async () => {
	let tests = [];

	tests.push(testBasicExeUnproxied());
	tests.push(testBasicExeProxied());
	tests.push(testBasicLib());
	tests.push(testBasicExeModules());
	tests.push(testBasicExeWithLib());
	tests.push(testExeWithCratesIoDependency());
	tests.push(testConditionalCompilation());
	tests.push(testLinkLibcurl());

	let results = await Promise.all(tests);
	tg.assert(results.every((r) => r === true));

	return true;
});

export let testBasicExeUnproxied = tg.target(async () => {
	let crateName = "native_basic_exe";
	let basicExe = await build({
		crateName,
		proxy: false,
		source: tests.get(crateName).then(tg.Directory.expect),
	});
	let basicExeOutput = await $`${crateName} | tee $OUTPUT`
		.env(basicExe)
		.then(tg.File.expect);
	let basicExeText = await basicExeOutput.text();
	tg.assert(basicExeText.trim() === "Hello, native world!");

	return true;
});

export let testBasicExeProxied = tg.target(async () => {
	let crateName = "native_basic_exe";
	let basicExe = await build({
		crateName,
		env: {
			WATERMARK: "2",
			TANGRAM_RUSTC_TRACING: "tangram=trace",
		},
		proxy: true,
		source: tests.get(crateName).then(tg.Directory.expect),
		verbose: true,
	});
	let basicExeOutput = await $`${crateName} | tee $OUTPUT`
		.env(basicExe)
		.then(tg.File.expect);
	let basicExeText = await basicExeOutput.text();
	tg.assert(basicExeText.trim() === "Hello, native world!");

	return true;
});

export let testBasicLib = tg.target(async () => {
	let crateName = "native_basic_lib";
	let basicLib = await build({
		crateName,
		source: tests.get(crateName).then(tg.Directory.expect),
	});
	let rlib = await basicLib.tryGet(`lib/lib${crateName}.rlib`);
	tg.assert(rlib !== undefined);

	return true;
});

export let testBasicExeModules = tg.target(async () => {
	let crateName = "native_basic_exe_modules";
	let basicExeModules = await build({
		crateName,
		source: tests.get(crateName).then(tg.Directory.expect),
	});
	let basicExeModulesOutput = await $`${crateName} | tee $OUTPUT`
		.env(basicExeModules)
		.then(tg.File.expect);
	let basicExeModulesText = await basicExeModulesOutput.text();
	tg.assert(basicExeModulesText.trim() === "Hello from a module!");

	return true;
});

export let testBasicExeWithLib = tg.target(async () => {
	let crateName = "native_basic_exe_with_lib";
	let depName = "native_basic_lib";
	let basicExeWithLib = await build({
		crateName,
		source: tests.get(crateName).then(tg.Directory.expect),
		rustDependencies: [
			{
				name: depName,
				artifact: tests.get(depName).then(tg.Directory.expect),
			},
		],
	});
	let basicExeWithLibOutput = await $`${crateName} | tee $OUTPUT`
		.env(basicExeWithLib)
		.then(tg.File.expect);
	let basicExeWithLibText = await basicExeWithLibOutput.text();
	tg.assert(basicExeWithLibText.trim() === "Hello from a library!");

	return true;
});

export let testExeWithCratesIoDependency = tg.target(async () => {
	let crateName = "native_deps_exe";
	let depsExe = await build({
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
	let depsExeOutput = await $`${crateName} | tee $OUTPUT`
		.env(depsExe)
		.then(tg.File.expect);
	let depsExeText = await depsExeOutput.text();
	tg.assert(depsExeText.trim() === 'b"Hello using the bytes crate!"');
	return true;
});

export let testConditionalCompilation = tg.target(async () => {
	let crateName = "native_cfg_exe";
	// Test without the optional feature.
	let cfgDisabled = await build({
		crateName: crateName,
		source: tests.get(crateName).then(tg.Directory.expect),
	});
	let cfgDisabledOutput = await $`${crateName} | tee $OUTPUT`
		.env(cfgDisabled)
		.then(tg.File.expect);
	let cfgDisabledText = await cfgDisabledOutput.text();
	tg.assert(cfgDisabledText.trim() === "optional feature disabled");

	// Test with the optional feature.
	let cfgEnabled = await build({
		crateName,
		cfgOptions: ["optional"],
		source: tests.get(crateName).then(tg.Directory.expect),
		verbose: true,
	});
	let cfgEnabledOutput = await $`${crateName} | tee $OUTPUT`
		.env(cfgEnabled)
		.then(tg.File.expect);
	let cfgEnabledText = await cfgEnabledOutput.text();
	tg.assert(cfgEnabledText.trim() === "optional feature enabled");

	return true;
});

import * as curl from "tg:curl" with { path: "../curl" };
import * as openssl from "tg:openssl" with { path: "../openssl" };
import * as zlib from "tg:zlib" with { path: "../zlib" };
import * as zstd from "tg:zstd" with { path: "../zstd" };
export let testLinkLibcurl = tg.target(async () => {
	let crateName = "native_exe_libcurl";

	// Obtain dependencies. Libcurl transitively requires libssl, libz, and libzstd.
	let libcurl = curl.build();
	let sslArtifact = openssl.build();
	let zlibArtifact = zlib.build();
	let zstdArtifact = zstd.build();
	let deps = [libcurl, sslArtifact, zlibArtifact, zstdArtifact];

	// Build the test.
	let exe = await build({
		crateName,
		env: std.env.arg(...deps),
		source: tests.get(crateName).then(tg.Directory.expect),
	});
	console.log("exe", await exe.id());

	// Libcurl transitively requires libssl at runtime.
	let host = await std.triple.host();
	let os = std.triple.os(host);
	let runtimeLibVar =
		os === "darwin" ? "DYLD_FALLBACK_LIBRARY_PATH" : "LD_LIBRARY_PATH";
	let exeOutput =
		await $`export ${runtimeLibVar}=$LIBRARY_PATH\n${crateName} | tee $OUTPUT`
			.env(exe, ...deps)
			.then(tg.File.expect);
	let exeText = await exeOutput.text();
	tg.assert(exeText.trim().includes(curl.metadata.version));

	return true;
});
