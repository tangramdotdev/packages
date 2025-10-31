import * as std from "std" with { local: "../std" };
import { $ } from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://go.dev/",
	license: "BSD-3-Clause",
	name: "go",
	repository: "https://github.com/golang/go",
	version: "1.25.3",
	tag: "go/1.25.3",
};

// See https://go.dev/dl.
const RELEASES: { [key: string]: { checksum: tg.Checksum; url: string } } = {
	["aarch64-linux"]: {
		checksum:
			"sha256:1d42ebc84999b5e2069f5e31b67d6fc5d67308adad3e178d5a2ee2c9ff2001f5",
		url: `https://go.dev/dl/go${metadata.version}.linux-arm64.tar.gz`,
	},
	["x86_64-linux"]: {
		checksum:
			"sha256:0335f314b6e7bfe08c3d0cfaa7c19db961b7b99fb20be62b0a826c992ad14e0f",
		url: `https://go.dev/dl/go${metadata.version}.linux-amd64.tar.gz`,
	},
	["aarch64-darwin"]: {
		checksum:
			"sha256:7c083e3d2c00debfeb2f77d9a4c00a1aac97113b89b9ccc42a90487af3437382",
		url: `https://go.dev/dl/go${metadata.version}.darwin-arm64.tar.gz`,
	},
	["x86_64-darwin"]: {
		checksum:
			"sha256:1641050b422b80dfd6299f8aa7eb8798d1cd23eac7e79f445728926e881b7bcd",
		url: `https://go.dev/dl/go${metadata.version}.darwin-amd64.tar.gz`,
	},
};

export type ToolchainArg = {
	host?: string;
};

export const self = async (
	arg?: tg.Unresolved<ToolchainArg>,
): Promise<tg.Directory> => {
	const resolved = await tg.resolve(arg);
	const host = resolved?.host ?? (await std.triple.host());
	const system = std.triple.archAndOs(host);
	tg.assert(
		system in RELEASES,
		`${system} is not supported in the Go toolchain.`,
	);

	const release = RELEASES[system as keyof typeof RELEASES];
	tg.assert(release !== undefined);
	const { checksum, url } = release;

	// Download the Go toolchain from `go.dev`.
	const downloaded = await std.download.extractArchive({ checksum, url });

	tg.assert(downloaded instanceof tg.Directory);
	const go = await downloaded.get("go");
	tg.assert(go instanceof tg.Directory);

	let artifact = tg.directory();
	for (const bin of ["bin/go", "bin/gofmt"]) {
		const file = await go.get(bin);
		tg.assert(file instanceof tg.File);
		artifact = tg.directory(artifact, {
			[bin]: std.wrap(file, {
				env: {
					GOROOT: go,
				},
			}),
		});
	}

	return artifact;
};

export default self;

export type Arg = {
	/** If the build requires network access, provide a checksum or the string "sha256:any" to accept any result, or `sha256:none` to ensure a failure, displaying the computed value. */
	checksum?: tg.Checksum;

	/** The source directory. */
	source: tg.Directory;

	/**
	 * Configure how we vendor dependencies:
	 * - `undefined` (default): Auto-detect - use native vendoring if no `vendor` dir is present.
	 * - `true` or `"native"`: Always use native vendoring (parse go.mod/go.sum and download with std.download).
	 * - `false`: Never update dependencies.
	 * - `"go"`: Use traditional `go mod vendor` command.
	 * - `tg.Template.Arg`: Use a custom vendoring command.
	 *
	 * Native vendoring downloads modules from proxy.golang.org using checksums from go.sum.
	 */
	vendor?: boolean | "native" | "go" | tg.Template.Arg;

	/**
	 * Explicitly enable or disable the `go generate` phase.
	 * - `false`, `undefined` (default): Never run `go generate`.
	 * - `true`: Always run `go generate`.
	 * - `{command: ...}`: Always run `go generate`, and override the specific command used.
	 */
	generate?: boolean | { command: tg.Template.Arg };

	/**
	 * Configure the installation phase, where binaries are built and copied to the output.
	 *
	 * If set, `command` will be run instead of `go install` to build the output binaries.
	 */
	install?: { command: tg.Template.Arg };

	/**
	 * Any user-specified environment environment variables that will be set during the build.
	 */
	env?: std.env.Arg;

	/** Should cgo be enabled? Default: true. */
	cgo?: boolean;

	/** The machine that will run the compilation. */
	host?: string;

	/** Should this build have network access? Must set a checksum to enable. Default: false. */
	network?: boolean;

	/** The machine the produced artifacts will run on. */
	target?: string;

	/** Any required SDK customization. */
	sdk?: std.sdk.Arg;
};

export const build = async (...args: std.Args<Arg>): Promise<tg.Directory> => {
	let {
		checksum,
		cgo = true,
		env: env_,
		generate,
		host: host_,
		install,
		network = false,
		sdk: sdkArg,
		source,
		target: target_,
		vendor: vendor_,
	} = await std.args.apply<Arg, Arg>({
		args,
		map: async (arg) => arg,
		reduce: {
			env: (a, b) => std.env.arg(a, b),
			sdk: (a, b) => std.sdk.arg(a, b),
			source: "set",
		},
	});
	const host = host_ ?? (await std.triple.host());
	const system = std.triple.archAndOs(host);
	const target = target_ ?? host;
	tg.assert(source, "Must provide a source directory.");

	const sdk = std.sdk({ host, target }, sdkArg);

	// Determine if we should vendor and which method to use.
	// vendor_ can be: undefined, boolean, "native", "go", or a template arg
	let shouldCreateVendor = false;
	let vendorMode: "native" | "traditional" = "native";
	let vendorCommand: tg.Template.Arg | undefined;

	// Check if source already has a vendor directory
	const hasVendorDir = !!(await source.tryGet("vendor"));

	if (vendor_ === false) {
		// Explicitly disabled
		shouldCreateVendor = false;
	} else if (vendor_ === undefined) {
		// Auto-detect: vendor if no vendor dir exists (default behavior)
		shouldCreateVendor = !hasVendorDir;
		vendorMode = "native";
	} else if (vendor_ === true || vendor_ === "native") {
		// Explicitly use native vendoring
		shouldCreateVendor = true;
		vendorMode = "native";
	} else if (vendor_ === "go") {
		// Use traditional go mod vendor
		shouldCreateVendor = true;
		vendorMode = "traditional";
		vendorCommand = "go mod vendor -v";
	} else {
		// Custom vendoring command (template arg)
		shouldCreateVendor = true;
		vendorMode = "traditional";
		vendorCommand = vendor_;
	}

	// Create vendor directory if needed
	let vendorArtifact: tg.Directory | undefined;
	if (shouldCreateVendor) {
		if (vendorMode === "traditional") {
			// Use traditional go mod vendor command
			tg.assert(vendorCommand !== undefined);
			vendorArtifact = await vendor({
				command: vendorCommand,
				source,
			});
		} else {
			// Use Tangram-native vendoring
			// Parse go.mod/go.sum and download dependencies from proxy.golang.org
			const goMod = await source.get("go.mod").then(tg.File.expect);
			const goSum = await source.get("go.sum").then(tg.File.expect);
			vendorArtifact = await vendorDependencies(goMod, goSum);
		}
	}

	// Determine if we should use -mod=vendor flag
	// Use it if: we created a vendor dir, OR the source already has one (unless explicitly disabled)
	const useModVendor = vendor_ !== false && (shouldCreateVendor || hasVendorDir);

	// Build args for go build/install
	let buildArgs = "";
	if (useModVendor) {
		buildArgs += "-mod=vendor";
	}

	// Build the vendored source code without internet access.
	const goArtifact = self({ host });

	const certFile = tg`${std.caCertificates()}/cacert.pem`;
	const cgoEnabled = cgo ? "1" : "0";

	// If cgo is enabled on Linux, we need to set linkmode to external to force using the Tangram proxy for every link operation, so that host object files can link to the SDK's libc.
	// On Darwin, this is not necessary because these symbols are provided by the OS in libSystem.dylib, and causes a codesigning failure.
	// See https://github.com/golang/go/blob/30c18878730434027dbefd343aad74963a1fdc48/src/cmd/cgo/doc.go#L999-L1023
	if (cgo && std.triple.os(system) === "linux") {
		buildArgs += " -ldflags=-linkmode=external";
	}

	// Come up with the right command to run in the `go generate` phase.
	// If using vendor mode, add -mod=vendor to the generate command.
	const generateArgs = useModVendor ? "-mod=vendor" : "";
	let generateCommand = await tg`go generate ${generateArgs} -v -x`;
	if (generate === false) {
		generateCommand =
			await tg`echo "'go generate' phase disabled by 'generate: false'"`;
	} else if (typeof generate === "object") {
		generateCommand = await tg.template(generate.command);
	}

	// Come up with the right command to run in the `go install` phase.
	let installCommand = await tg`go install -v ${buildArgs}`;
	if (install) {
		installCommand = await tg.template(install.command);
	}

	const arch = std.triple.arch(target);
	const goArch = arch === "aarch64" ? "arm64" : "amd64";
	const goOs = std.triple.os(target);

	const envs: Array<tg.Unresolved<std.env.Arg>> = [
		sdk,
		goArtifact,
		{
			CGO_ENABLED: cgoEnabled,
			GOARCH: goArch,
			GOOS: goOs,
			SSL_CERT_FILE: certFile,
			TANGRAM_HOST: system,
		},
		env_,
	];

	const env = std.env.arg(...envs);

	// Build the setup commands for vendor directory.
	let vendorSetup = await tg``;
	if (vendorArtifact) {
		vendorSetup = await tg`
		# Symlink vendor directory to avoid copying large dependency trees
		ln -sf ${vendorArtifact} ./work/vendor`;
	}

	const output = await $`
		set -x
		cp -R ${source}/. ./work
		chmod -R u+w ./work
		${vendorSetup}
		cd ./work

		export TMPDIR=$PWD/gotmp
		mkdir -p $TMPDIR
		mkdir -p $OUTPUT/bin

		export GOPATH=$OUTPUT
		export GOCACHE=$TMPDIR
		export GOMODCACHE=$TMPDIR
		export GOTMPDIR=$TMPDIR

		${generateCommand}
		${installCommand}`
		.env(env)
		.host(system)
		.checksum(checksum)
		.network(network)
		.then(tg.Directory.expect);

	// Get a list of all dynamically-linked binaries in the output.
	let binDir = await output.get("bin").then(tg.Directory.expect);

	// Wrap each executable in the /bin directory.
	for await (const [name, file] of binDir) {
		if (!(file instanceof tg.Directory)) {
			binDir = await tg.directory(binDir, {
				[name]: std.wrap({
					executable: file,
				}),
			});
		}
	}

	// Return the output.
	return tg.directory(source, {
		["bin"]: binDir,
	});
};

export type VendorArgs = {
	source: tg.Directory;
	/** Command to run to vendor the deps, by default `go mod vendor`. */
	command?: tg.Unresolved<tg.Template.Arg>;
};

export const vendor = async ({
	command: optionalCommand,
	source,
}: VendorArgs): Promise<tg.Directory> => {
	const pruned = source;

	const command = optionalCommand ?? "go mod vendor -v";
	return await $`
				export GOMODCACHE="$(mktemp -d)"

				# Create a writable temp dir.
				work="$(mktemp -d)" && cp -r -T '${pruned}/' "$work" && cd "$work"
				mkdir -p "$OUTPUT"

				${command}

				mv -T ./vendor "$OUTPUT" || true
			`
		.env(self())
		.env({ SSL_CERT_DIR: std.caCertificates() })
		.checksum("sha256:any")
		.network(true)
		.then(tg.Directory.expect);
};

type GoModule = {
	path: string;
	version: string;
};

/** Parse go.sum file to extract module checksums and list of all dependencies.
 * Returns both a map of checksums and an array of all modules found in go.sum.
 * go.sum contains ALL dependencies including transitive ones, making it the
 * complete source of truth for what needs to be vendored.
 */
export const parseGoSum = async (
	goSumFile: tg.File,
): Promise<{ checksums: Map<string, string>; modules: Array<GoModule> }> => {
	const content = await goSumFile.text();
	const checksums = new Map<string, string>();
	const modulesSet = new Map<string, GoModule>();

	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("//")) continue;

		// Format: "module version hash" - skip go.mod entries (version ends with "/go.mod")
		const parts = trimmed.split(/\s+/);
		const [modulePath, version, hash] = parts;
		if (!modulePath || !version || !hash || version.endsWith("/go.mod")) {
			continue;
		}

		const key = `${modulePath}@${version}`;
		checksums.set(key, hash);
		if (!modulesSet.has(key)) {
			modulesSet.set(key, { path: modulePath, version });
		}
	}

	return {
		checksums,
		modules: Array.from(modulesSet.values()),
	};
};

/** Parse go.mod file to extract list of required dependencies.
 * Returns all modules that appear in require blocks in go.mod.
 * For vendor/modules.txt, ALL modules in go.mod should be marked as "## explicit",
 * regardless of whether they have the "// indirect" comment or not.
 * Only modules that appear ONLY in go.sum (not in go.mod) should lack the explicit marker.
 */
export const parseGoMod = async (
	goModFile: tg.File,
): Promise<Set<string>> => {
	const content = await goModFile.text();
	const modulePaths = new Set<string>();
	let inRequireBlock = false;

	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("//")) continue;

		if (trimmed.startsWith("require (")) {
			inRequireBlock = true;
		} else if (inRequireBlock && trimmed === ")") {
			inRequireBlock = false;
		} else if (inRequireBlock || trimmed.startsWith("require ")) {
			// Parse "require module version" or "module version" in block
			const requireLine = trimmed.startsWith("require ")
				? trimmed.substring(8)
				: trimmed;
			const [path, version] = requireLine.split(/\s+/);

			// Skip local replace directives
			if (path && version && !path.startsWith(".") && !version.startsWith(".")) {
				modulePaths.add(path);
			}
		}
	}

	return modulePaths;
};

/** Encode a module path for use with the Go module proxy.
 * The proxy uses case-insensitive encoding where uppercase letters are
 * encoded as "!lowercase" (e.g., "AlecAivazis" -> "!alec!aivazis").
 * This is required because some filesystems are case-insensitive.
 * See https://go.dev/ref/mod#goproxy-protocol
 */
const encodeModulePath = (path: string): string => {
	// Replace each uppercase letter with "!" followed by the lowercase version
	return path.replace(/[A-Z]/g, (letter) => `!${letter.toLowerCase()}`);
};

/** Download Go modules from proxy.golang.org using h1 checksums from go.sum.
 * Downloads modules with network access and verifies content integrity using
 * the h1 hashes in go.sum (which verify normalized module contents).
 * This matches how the Go toolchain itself handles module downloads.
 */
export const vendorDependencies = async (
	goModArg: tg.Unresolved<tg.File>,
	goSumArg: tg.Unresolved<tg.File>,
): Promise<tg.Directory> => {
	const goMod = await tg.resolve(goModArg);
	const goSum = await tg.resolve(goSumArg);

	// Parse go.mod to get all modules that appear in require blocks.
	// These should be marked as "## explicit" in vendor/modules.txt.
	const explicitModules = await parseGoMod(goMod);

	// Parse go.sum to get checksums and all available modules.
	const { checksums, modules: allModules } = await parseGoSum(goSum);

	// Filter to only vendor modules that are in go.mod.
	// Test-only dependencies may appear in go.sum but not in go.mod,
	// and Go will complain if they're in the vendor directory but not in go.mod.
	const modules = allModules.filter((m) => explicitModules.has(m.path));

	tg.assert(
		modules.length > 0,
		"No modules found to vendor. Check that go.mod has require statements.",
	);

	// Download all modules in parallel.
	// We use checksum: "sha256:any" because the h1 hashes in go.sum verify the normalized module contents (not the raw zip), which is what matters.
	// We trust proxy.golang.org (the official Go proxy) to serve correct files.
	const downloads = await Promise.all(
		modules.map(async ({ path, version }) => {
			const key = `${path}@${version}`;
			const hash = checksums.get(key);

			tg.assert(
				hash !== undefined,
				`No checksum found in go.sum for module ${key}. Run 'go mod tidy' to update go.sum.`,
			);

			tg.assert(
				hash.startsWith("h1:"),
				`Unsupported hash format for ${key}: ${hash}. Expected h1: format.`,
			);

			// Encode the module path for the Go proxy (uppercase -> !lowercase).
			const encodedPath = encodeModulePath(path);
			const url = `https://proxy.golang.org/${encodedPath}/@v/${version}.zip`;

			// Download with network access, accepting any checksum.
			// The h1 hash in go.sum provides cryptographic verification of contents
			const archive = await std
				.download({
					url,
					checksum: "sha256:any",
					mode: "extract",
				})
				.then(tg.Directory.expect);

			// The extracted archive can be nested multiple levels depending on the module path.
			// Keep unwrapping until we reach the actual module contents.
			let moduleDir = archive;
			while (true) {
				const entries = await moduleDir.entries();
				const keys = Object.keys(entries);
				if (
					keys.length === 1 &&
					keys[0] !== undefined &&
					entries[keys[0]] instanceof tg.Directory
				) {
					moduleDir = await std.directory.unwrap(moduleDir);
				} else {
					break;
				}
			}

			return { path, moduleDir };
		}),
	);

	// Build vendor directory by placing each module at its path.
	// We need to build a nested structure: vendor/github.com/user/repo/...
	const vendorStructure: Record<string, any> = {};
	const modulesWithPackages: Array<{
		module: GoModule;
		packages: string[];
		goVersion?: string;
	}> = [];

	for (const { path, moduleDir } of downloads) {
		// Create nested structure for this module path.
		const parts = path.split("/");
		let current = vendorStructure;
		for (let i = 0; i < parts.length - 1; i++) {
			const part = parts[i];
			tg.assert(part !== undefined);
			if (!(part in current)) {
				current[part] = {};
			}
			current = current[part];
		}
		const lastPart = parts[parts.length - 1];
		tg.assert(lastPart !== undefined);
		current[lastPart] = moduleDir;

		// Find all Go packages in this module.
		const packages = await findGoPackages(path, moduleDir);
		const module = modules.find((m) => m.path === path);
		tg.assert(module !== undefined, `Module ${path} not found`);

		// Extract go version from module's go.mod if present.
		const goModFile = await moduleDir.tryGet("go.mod");
		let goVersion: string | undefined;
		if (goModFile instanceof tg.File) {
			goVersion = await extractGoVersion(goModFile);
		}

		// Only include goVersion if it's defined (exactOptionalPropertyTypes).
		if (goVersion !== undefined) {
			modulesWithPackages.push({ module, packages, goVersion });
		} else {
			modulesWithPackages.push({ module, packages });
		}
	}

	// Convert the nested structure to a directory.
	let vendorDir = await tg.directory(vendorStructure);

	// Create vendor/modules.txt file with all packages.
	const modulesTxt = await createModulesTxt(
		modulesWithPackages,
		explicitModules,
	);
	vendorDir = await tg.directory(vendorDir, {
		"modules.txt": tg.file(modulesTxt),
	});

	return vendorDir;
};

/** Extract go version from a go.mod file. */
const extractGoVersion = async (
	goModFile: tg.File,
): Promise<string | undefined> => {
	const content = await goModFile.text();
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("go ")) {
			// Extract version like "go 1.18" or "go 1.18.0"
			const versionMatch = trimmed.match(/^go\s+(\d+\.\d+)/);
			if (versionMatch && versionMatch[1]) {
				return versionMatch[1];
			}
		}
	}
	return undefined;
};

/** Recursively find all Go packages in a module directory. */
const findGoPackages = async (
	modulePath: string,
	dir: tg.Directory,
	prefix = "",
): Promise<string[]> => {
	const entries = await dir.entries();
	const packages: string[] = [];

	// Check if current directory has Go files (is a package).
	const hasGoFiles = Object.entries(entries).some(
		([name, entry]) => entry instanceof tg.File && name.endsWith(".go"),
	);
	if (hasGoFiles) {
		packages.push(prefix ? `${modulePath}/${prefix}` : modulePath);
	}

	// Recursively check subdirectories (skip testdata and vendor).
	for (const [name, entry] of Object.entries(entries)) {
		if (entry instanceof tg.Directory && name !== "testdata" && name !== "vendor") {
			const subPrefix = prefix ? `${prefix}/${name}` : name;
			packages.push(...await findGoPackages(modulePath, entry, subPrefix));
		}
	}

	return packages;
};

/** Generate vendor/modules.txt file content with all packages.
 * Marks modules as "## explicit" if they appear in ANY require block in go.mod,
 * regardless of whether they have the "// indirect" comment.
 * Only modules that appear ONLY in go.sum (not in go.mod) lack the explicit marker.
 */
const createModulesTxt = async (
	modulesWithPackages: Array<{
		module: GoModule;
		packages: string[];
		goVersion?: string;
	}>,
	explicitModules: Set<string>,
): Promise<string> => {
	let content = "";

	for (const { module, packages, goVersion } of modulesWithPackages) {
		const { path, version } = module;
		content += `# ${path} ${version}\n`;

		// Mark as explicit if this module appears in go.mod (in any require block)
		const isExplicit = explicitModules.has(path);

		if (isExplicit) {
			// Include go version requirement if present (format: "## explicit; go 1.18").
			if (goVersion) {
				content += `## explicit; go ${goVersion}\n`;
			} else {
				content += `## explicit\n`;
			}
		}

		// List all packages in this module.
		for (const pkg of packages.sort()) {
			content += `${pkg}\n`;
		}
	}

	return content;
};

export const test = async () => {
	await Promise.all([testCgo(), testPlain(), testNativeVendor()]);
};

export const testVendorStructure = async () => {
	// Test that vendor directory structure is correct with all dependencies
	const source = await tg.directory({
		["go.mod"]: tg.file(`
			module testvendor
			go 1.21
			require rsc.io/quote v1.5.2
			require (
				golang.org/x/text v0.0.0-20170915032832-14c0d48ead0c // indirect
				rsc.io/sampler v1.3.0 // indirect
			)
		`),
		["go.sum"]: tg.file(`
			golang.org/x/text v0.0.0-20170915032832-14c0d48ead0c h1:qgOY6WgZOaTkIIMiVjBQcw93ERBE4m30iBm00nkL0i8=
			rsc.io/quote v1.5.2 h1:w5fcysjrx7yqtD/aO+QwRjYZOKnaM9Uh2b40tElTs3Y=
			rsc.io/sampler v1.3.0 h1:7uVkIFmeBqHfdjD+gZwtXXI+RODJ2Wc4O7MPEh/QiW4=
		`),
	});

	const goMod = await source.get("go.mod").then(tg.File.expect);
	const goSum = await source.get("go.sum").then(tg.File.expect);

	const vendorDir = await vendorDependencies(goMod, goSum);

	// Check all three modules are present
	const rscIo = await vendorDir.get("rsc.io").then(tg.Directory.expect);
	const quote = await rscIo.get("quote").then(tg.Directory.expect);
	const sampler = await rscIo.get("sampler").then(tg.Directory.expect);

	const golang = await vendorDir.get("golang.org").then(tg.Directory.expect);
	const x = await golang.get("x").then(tg.Directory.expect);
	const text = await x.get("text").then(tg.Directory.expect);

	// Verify module files exist
	tg.assert(await quote.tryGet("quote.go"), "Expected quote.go in vendor");
	tg.assert(
		await sampler.tryGet("sampler.go"),
		"Expected sampler.go in vendor",
	);

	// golang.org/x/text has subpackages - verify it has the expected structure
	const language = await text.tryGet("language");
	tg.assert(language !== undefined, "Expected language subpackage in vendor");
};

export const testCgo = async () => {
	const source = tg.directory({
		["main.go"]: tg.file(`
			package main

			/*
			#include <stdio.h>
			#include <stdlib.h>

			void hello_from_c() {
				printf("Hello from C!\\n");
				fflush(stdout);
			}

			char* get_message() {
				return "CGO is working!";
			}
			*/
			import "C"
			import (
				"fmt"
			)

			func main() {
				fmt.Println("Hello from Go!")

				// Call C function
				C.hello_from_c()

				// Get string from C and convert to Go string
				cMessage := C.get_message()
				goMessage := C.GoString(cMessage)
				fmt.Println(goMessage)
			}
			`),
		["go.mod"]: tg.file(`
			module testcgo
			go 1.21
		`),
	});

	const host = await std.triple.host();
	const system = std.triple.archAndOs(host);
	const os = std.triple.os(system);

	// FIXME: Skip CGO test on Darwin due to code signing issue.
	// https://github.com/tangramdotdev/packages/issues/169
	if (os === "darwin") {
		console.log(
			"Skipping testCgo on Darwin due to Go 1.25.3 linker code signing issues",
		);
		return;
	}

	// Build using go.build with CGO enabled
	const artifact = await build({
		source,
		vendor: false,
		cgo: true,
	});

	// Run the built binary and check output
	const executable = tg`${artifact}/bin/testcgo > $OUTPUT 2>&1`;
	const output = await $`${executable}`
		.then(tg.File.expect)
		.then((f) => f.text());

	tg.assert(
		output.includes("Hello from C!"),
		`Expected output to contain "Hello from C!", got: ${output}`,
	);
	tg.assert(
		output.includes("Hello from Go!"),
		`Expected output to contain "Hello from Go!", got: ${output}`,
	);
	tg.assert(
		output.includes("CGO is working!"),
		`Expected output to contain "CGO is working!", got: ${output}`,
	);
};

export const testPlain = async () => {
	const source = tg.directory({
		["main.go"]: tg.file`
			package main
			import "fmt"

			func main() {
					fmt.Println("hello world")
			}
		`,
		["go.mod"]: tg.file`
			module testplain
			go 1.21
		`,
	});

	// Build using go.build with CGO disabled
	const artifact = await build({
		source,
		vendor: false,
		cgo: false,
	});

	// Run the built binary and check output
	const executable = tg`${artifact}/bin/testplain > $OUTPUT 2>&1`;
	const output = await $`${executable}`
		.then(tg.File.expect)
		.then((f) => f.text());

	tg.assert(
		output.includes("hello world"),
		`Expected output to contain "hello world", got: ${output}`,
	);
};

export const testNativeVendor = async () => {
	// Make sure the vendor structure is correct.
	await testVendorStructure();

	// Create a minimal Go module that uses a simple external dependency
	// Note: The checksums in vendor.json are the actual zip file checksums,
	// which differ from the h1 hashes in go.sum (those are computed on normalized content)
	const source = tg.directory({
		["main.go"]: tg.file(`
			package main

			import (
				"fmt"
				"rsc.io/quote"
			)

			func main() {
				fmt.Println(quote.Hello())
			}
		`),
		["go.mod"]: tg.file(`
			module testvendor

			go 1.21

			require rsc.io/quote v1.5.2

			require (
				golang.org/x/text v0.0.0-20170915032832-14c0d48ead0c // indirect
				rsc.io/sampler v1.3.0 // indirect
			)
		`),
		["go.sum"]: tg.file(`
			golang.org/x/text v0.0.0-20170915032832-14c0d48ead0c h1:qgOY6WgZOaTkIIMiVjBQcw93ERBE4m30iBm00nkL0i8=
			golang.org/x/text v0.0.0-20170915032832-14c0d48ead0c/go.mod h1:NqM8EUOU14njkJ3fqMW+pc6Ldnwhi/IjpwHt7yyuwOQ=
			rsc.io/quote v1.5.2 h1:w5fcysjrx7yqtD/aO+QwRjYZOKnaM9Uh2b40tElTs3Y=
			rsc.io/quote v1.5.2/go.mod h1:LzX7hefJvL54yjefDEDHNONDjII0t9xZLPXsUe+TKr0=
			rsc.io/sampler v1.3.0 h1:7uVkIFmeBqHfdjD+gZwtXXI+RODJ2Wc4O7MPEh/QiW4=
			rsc.io/sampler v1.3.0/go.mod h1:T1hPZKmBbMNahiBKFy5HrXp6adAjACjK9JXDnKaTXpA=
		`),
	});

	// Build using native vendoring (now the default)
	const artifact = await build({
		source,
		vendor: true,
		cgo: false,
	});

	// Verify the binary was built
	const bin = await artifact.get("bin").then(tg.Directory.expect);
	const entries = await bin.entries();
	tg.assert(
		"testvendor" in entries,
		`Expected binary 'testvendor' to be built, found: ${Object.keys(entries).join(", ")}`,
	);

	// Run the binary and check output
	const executable = tg`${artifact}/bin/testvendor > $OUTPUT 2>&1`;
	const output = await $`${executable}`
		.then(tg.File.expect)
		.then((f) => f.text());

	tg.assert(
		output.includes("Hello, world"),
		`Expected output to contain "Hello, world", got: ${output}`,
	);
};
