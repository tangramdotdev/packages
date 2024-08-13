import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };
import * as zlib from "tg:zlib" with { path: "../zlib" };

import * as proxy_ from "./proxy.tg.ts";
export * as proxy from "./proxy.tg.ts";

import * as cargo_ from "./cargo.tg.ts";
export * as cargo from "./cargo.tg.ts";

export let metadata = {
	homepage: "https://www.rust-lang.org",
	license: "MIT",
	name: "rust",
	repository: "https://github.com/rust-lang/rust",
	version: "0.0.0",
};

let VERSION = "1.80.1" as const;
let PROFILE = "minimal" as const;

type ToolchainArg = {
	host?: string;
	target?: string;
	targets?: Array<string>;
};

export let toolchain = tg.target(async (arg?: ToolchainArg) => {
	// Determine the list of target triples to support other than the inferred host.
	let detectedHost = await std.triple.host();
	let host = rustTriple(arg?.host ?? detectedHost);
	let targets = [];
	if (arg?.target && arg.target !== host) {
		targets.push(arg.target);
	}
	if (arg?.targets) {
		for (let target of arg?.targets) {
			if (target !== host) {
				targets.push(target);
			}
		}
	}

	// Download the Rust manifest for the selected version.
	let manifestArtifact = await std.download({
		url: `https://static.rust-lang.org/dist/channel-rust-${VERSION}.toml`,
		checksum: "unsafe",
		decompress: false,
		extract: false,
	});

	// Parse the manifest.
	tg.assert(manifestArtifact instanceof tg.File);
	let manifest = (await tg.encoding.toml.decode(
		await manifestArtifact.text(),
	)) as RustupManifestV2;

	// Get all the available packages for the selected profile and target.
	let packageNames = manifest.profiles[PROFILE];
	tg.assert(Array.isArray(packageNames));
	let packages = packageNames.flatMap((packageName) => {
		let data = manifest.pkg[packageName];
		let pkg = data?.target[host];
		if (pkg?.available === true) {
			return [[packageName, pkg]] as const;
		} else {
			return [];
		}
	});

	// Add any additionally requested rust-std targets.
	for (let target of targets) {
		let name = "rust-std";
		let data = manifest.pkg[name];
		let pkg = data?.target[target];
		if (pkg?.available === true) {
			packages.push([`${name}-${target}`, pkg]);
		}
	}

	// Download each package, and add each one as a subdirectory. The subdirectory will be named with the package's name.
	let packagesArtifact = await tg.directory();
	for (let [name, pkg] of packages) {
		let artifact = await std.download({
			checksum: `sha256:${pkg.xz_hash}`,
			decompress: "xz",
			extract: "tar",
			url: pkg.xz_url,
		});
		packagesArtifact = await tg.directory(packagesArtifact, {
			[name]: artifact,
		});
	}

	// Obtain an SDK.  If cross-targets were specified, use a cross-compiling SDK.
	let sdk = await std.sdk({ host, targets });

	// Install each package.
	let rustInstall = await $`
			for package in ${packagesArtifact}/*/* ; do
				echo "Installing $package"
				bash "$package/install.sh" --prefix="$OUTPUT"
				chmod -R +w "$OUTPUT"
			done
		`
		.env(sdk)
		.then(tg.Directory.expect);

	// Wrap the Rust binaries.
	let executables = [
		"bin/rustc",
		"bin/cargo",
		"bin/rustdoc",
		"bin/rust-gdb",
		"bin/rust-gdbgui",
		"bin/rust-lldb",
	];

	let artifact = tg.directory();

	let zlibArtifact = await zlib.build({ host });

	for (let executable of executables) {
		let wrapped = std.wrap(tg.symlink(tg`${rustInstall}/${executable}`), {
			libraryPaths: [
				tg.symlink(tg`${rustInstall}/lib`),
				tg.symlink(tg`${zlibArtifact}/lib`),
			],
		});

		artifact = tg.directory(artifact, {
			[executable]: wrapped,
		});
	}

	return artifact;
});

export default toolchain;

type RustupManifestV2 = {
	"manifest-version": "2";
	artifacts: {
		[artifact: string]: {
			target: {
				[target: string]: Array<{
					"hash-sha256": string;
					url: string;
				}>;
			};
		};
	};
	date: string;
	pkg: {
		[pkg: string]: {
			git_commit_hash: string;
			target: {
				[target: string]:
					| undefined
					| { available: false }
					| {
							available: true;
							hash: string;
							url: string;
							xz_hash: string;
							xz_url: string;
					  };
			};
			version: string;
		};
	};
	profiles: {
		[profile: string]: Array<string>;
	};
	renames: {
		[alias: string]: {
			to: string;
		};
	};
};

export let rustTriple = (triple: string): string => {
	let components = std.triple.components(std.triple.normalize(triple));
	if (components.os === "darwin") {
		return std.triple.create({
			...components,
			vendor: "apple",
		});
	} else if (components.os === "linux") {
		return std.triple.create({
			...components,
			environment: components.environment ?? "gnu",
		});
	} else {
		throw new Error(`Unsupported OS: ${components.os}`);
	}
};

export let test = tg.target(async () => {
	let tests = [testHostToolchain()];
	await Promise.all(tests);
	return true;
});

export let testHostToolchain = tg.target(async () => {
	let rustArtifact = await toolchain();
	await $`rustc --version && cargo --version`.env(rustArtifact);
	return rustArtifact;
});

export let testCrossToolchain = tg.target(async () => {
	// Detect the host triple.
	let host = await std.triple.host();

	// Determine the target triple with differing architecture from the host.
	let hostArch = std.triple.arch(host);
	let targetArch = hostArch === "x86_64" ? "aarch64" : "x86_64";
	let target = std.triple.create({
		arch: targetArch,
		vendor: "unknown",
		os: "linux",
		environment: "gnu",
	});

	let crossRust = await toolchain({ targets: [target] });

	await $`rustc --version && cargo --version`.env(crossRust);
	return crossRust;
});

import tests from "./tests" with { type: "directory" };
export let testUnproxiedWorkspace = tg.target(async () => {
	let helloWorkspace = cargo_.build({
		source: tests.get("hello-workspace"),
		proxy: false,
	});

	let output = await $`
		${helloWorkspace}/bin/cli >> $OUTPUT
	`.then(tg.File.expect);
	let text = await output.text();
	tg.assert(text.trim() === "Hello from a workspace!");
	return true;
});

import * as pkgconfig from "tg:pkg-config" with { path: "../pkgconfig" };
import * as openssl from "tg:openssl" with { path: "../openssl" };
export let testCargoProxy = tg.target(async () => {
	await proxy_.test();

	// Build the basic proxy test.
	let helloWorld = await cargo_.build({
		source: tests.get("hello-world"),
		proxy: true,
		env: {
			TANGRAM_RUSTC_TRACING: "tangram=trace",
		},
	});
	console.log("helloWorld result", await helloWorld.id());

	// Assert it produces the correct output.
	let helloOutput = await $`hello-world | tee $OUTPUT`
		.env(helloWorld)
		.then(tg.File.expect);
	let helloText = await helloOutput.text();
	tg.assert(helloText.trim() === "hello, proxy!\n128\nHello, build!");

	// Build the openssl proxy test.
	let helloOpenssl = await cargo_.build({
		source: tests.get("hello-openssl"),
		env: std.env.arg(await openssl.build(), pkgconfig.build(), {
			TANGRAM_RUSTC_TRACING: "tangram=trace",
		}),
		proxy: true,
	});
	console.log("helloOpenssl result", await helloWorld.id());

	// Assert it produces the correct output.
	let opensslOutput = await $`hello-openssl | tee $OUTPUT`
		.env(helloOpenssl)
		.then(tg.File.expect);
	let opensslText = await opensslOutput.text();
	tg.assert(
		opensslText.trim() === "Hello, from a crate that links against libssl!",
	);

	// Build the workspace test.
	let helloWorkspace = await cargo_.build({
		source: tests.get("hello-workspace"),
		proxy: true,
		env: {
			TANGRAM_RUSTC_TRACING: "tangram=trace",
		},
	});
	console.log("helloWorkspace result", await helloWorkspace.id());

	// Assert it produces the correct output.
	let workspaceOutput = await $`cli | tee $OUTPUT`
		.env(helloWorkspace)
		.then(tg.File.expect);
	let workspaceText = await workspaceOutput.text();
	tg.assert(workspaceText.trim() === "Hello from a workspace!");

	return true;
});

// Compare the results of cargo vendor and vendorDependencies.
export let testVendorDependencies = tg.target(async () => {
	let sourceDirectory = tests.get("hello-openssl");
	tg.assert(sourceDirectory instanceof tg.Directory);
	let cargoLock = await sourceDirectory.get("Cargo.lock");
	tg.assert(cargoLock instanceof tg.File);
	let tgVendored = cargo_.vendorDependencies(cargoLock);

	let certFile = tg`${std.caCertificates()}/cacert.pem`;
	let vendorScript = tg`
		SOURCE="$(realpath ${sourceDirectory})"
		cargo vendor --versioned-dirs --locked --manifest-path $SOURCE/Cargo.toml "$OUTPUT"
	`;
	let rustArtifact = toolchain();
	let sdk = std.sdk();

	let cargoVendored = await $`${vendorScript}`
		.checksum("unsafe")
		.env(sdk, rustArtifact, {
			CARGO_REGISTRIES_CRATES_IO_PROTOCOL: "sparse",
			CARGO_HTTP_CAINFO: certFile,
			RUST_TARGET: "x86_64-linux-unknown-gnu",
			SSL_CERT_FILE: certFile,
		})
		.then(tg.Directory.expect);
	return tg.directory({
		tgVendored,
		cargoVendored,
	});
});
