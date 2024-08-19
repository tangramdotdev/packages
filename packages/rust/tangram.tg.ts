import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };
import * as zlib from "tg:zlib" with { path: "../zlib" };

import * as build_ from "./build.tg.ts";
export * as build from "./build.tg.ts";

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

export let VERSION = "1.80.1" as const;
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
	let tests = [];

	tests.push(testHostToolchain());
	tests.push(testCrossToolchain());
	tests.push(testCargo());
	tests.push(testCargoProxy());
	tests.push(testNativeBuild());

	let results = await Promise.all(tests);
	tg.assert(results.every((r) => r === true));

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

export let testCargo = tg.target(async () => {
	return await cargo_.test();
});

export let testCargoProxy = tg.target(async () => {
	return await proxy_.test();
});

export let testNativeBuild = tg.target(async () => {
	return await build_.test();
});
