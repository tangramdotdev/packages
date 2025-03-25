import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };
import zlib from "zlib" with { path: "../zlib" };

import * as build_ from "./build.tg.ts";
export * as build from "./build.tg.ts";

import * as proxy_ from "./proxy.tg.ts";
export * as proxy from "./proxy.tg.ts";

import * as cargo_ from "./cargo.tg.ts";
export * as cargo from "./cargo.tg.ts";

export const metadata = {
	homepage: "https://www.rust-lang.org",
	license: "MIT",
	name: "rust",
	repository: "https://github.com/rust-lang/rust",
	version: "0.0.0",
};

const PROFILE = "minimal" as const;
export const VERSION = "1.85.1" as const;

export type ToolchainArg = {
	host?: string;
	target?: string;
	targets?: Array<string>;
};

export const self = tg.command(async (arg?: ToolchainArg) => {
	// Determine the list of target triples to support other than the inferred host.
	const detectedHost = await std.triple.host();
	const host = rustTriple(arg?.host ?? detectedHost);
	const targets = [];
	if (arg?.target && arg.target !== host) {
		targets.push(arg.target);
	}
	if (arg?.targets) {
		for (const target of arg?.targets) {
			if (target !== host) {
				targets.push(target);
			}
		}
	}

	// Download the Rust manifest for the selected version.
	const manifestArtifact = await std.download({
		url: `https://static.rust-lang.org/dist/channel-rust-${VERSION}.toml`,
		checksum:
			"sha256:1e7dae690cd12e27405a97e64704917489a27c650201bf47780a936055d67909",
		decompress: false,
		extract: false,
	});

	// Parse the manifest.
	tg.assert(manifestArtifact instanceof tg.File);
	const manifest = (await tg.encoding.toml.decode(
		await manifestArtifact.text(),
	)) as RustupManifestV2;

	// Get all the available packages for the selected profile and target.
	const packageNames = manifest.profiles[PROFILE];
	tg.assert(Array.isArray(packageNames));
	const packages = packageNames.flatMap((packageName) => {
		const data = manifest.pkg[packageName];
		const pkg = data?.target[host];
		if (pkg?.available === true) {
			return [[packageName, pkg]] as const;
		} else {
			return [];
		}
	});

	// Add any additionally requested rust-std targets.
	for (const target of targets) {
		const name = "rust-std";
		const data = manifest.pkg[name];
		const pkg = data?.target[target];
		if (pkg?.available === true) {
			packages.push([`${name}-${target}`, pkg]);
		}
	}

	// Download each package, and add each one as a subdirectory. The subdirectory will be named with the package's name.
	let packagesArtifact = await tg.directory();
	for (const [name, pkg] of packages) {
		const artifact = await std.download({
			checksum: `sha256:${pkg.xz_hash}`,
			url: pkg.xz_url,
		});
		packagesArtifact = await tg.directory(packagesArtifact, {
			[name]: artifact,
		});
	}

	// Obtain an SDK.  If cross-targets were specified, use a cross-compiling SDK.
	const sdk = await std.sdk({ host, targets });

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

	// Proxy rust-objcopy.
	rustInstall = await proxyRustObjcopy({
		build: host,
		buildToolchain: sdk,
		host,
		rustInstall,
	});

	// Wrap the Rust binaries.
	const executables = [
		"bin/rustc",
		"bin/cargo",
		"bin/rustdoc",
		"bin/rust-gdb",
		"bin/rust-gdbgui",
		"bin/rust-lldb",
	];

	let artifact = tg.directory();

	const zlibArtifact = await zlib({ host });

	for (const executable of executables) {
		// Add the zlib library path with the default strategy, isolating libz.
		let wrapped = std.wrap(tg.symlink(tg`${rustInstall}/${executable}`), {
			libraryPaths: [tg`${zlibArtifact}/lib`],
		});

		// Add the rust library path with no library path handling, preserving the whole structure and `rustlib` subdirectory.
		wrapped = std.wrap(wrapped, {
			libraryPaths: [tg`${rustInstall}/lib`],
			libraryPathStrategy: "none",
		});

		artifact = tg.directory(artifact, {
			[executable]: wrapped,
		});
	}

	return artifact;
});

export default self;

type ProxyRustObjcopyArg = {
	build: string;
	buildToolchain: std.env.Arg;
	host: string;
	rustInstall: tg.Directory;
};

export const proxyRustObjcopy = tg.command(
	async (arg: ProxyRustObjcopyArg): Promise<tg.Directory> => {
		const { build, buildToolchain, host, rustInstall } = arg;

		// Get the rust-objcopy executable.
		// NOTE - `host` is assumed to already be a valid rust triple, produced by the caller.
		const rustObjcopySubpath = `lib/rustlib/${host}/bin/rust-objcopy`;
		const rustObjcopyExe = await rustInstall
			.get(rustObjcopySubpath)
			.then(tg.File.expect);

		// Produce the proxy wrapper.
		const wrappedRustObjcopyExe = await std.stripProxy({
			buildToolchain,
			build,
			host,
			stripCommand: rustObjcopyExe,
		});

		// Replace the original path with the wrapper.
		return tg.directory(rustInstall, {
			[rustObjcopySubpath]: wrappedRustObjcopyExe,
		});
	},
);

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

export const rustTriple = (triple: string): string => {
	const components = std.triple.components(std.triple.normalize(triple));
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

export const test = tg.command(async () => {
	const tests = [];

	tests.push(testHostToolchain());
	tests.push(testCargo());
	tests.push(testCargoProxy());
	tests.push(testNativeBuild());

	const results = await Promise.all(tests);
	// tg.assert(results.every((r) => r === true));

	return true;
});

export const testHostToolchain = tg.command(async () => {
	const rustArtifact = await self();
	await $`rustc --version && cargo --version`.env(rustArtifact);
	return rustArtifact;
});

export const testCrossToolchain = tg.command(async () => {
	// Detect the host triple.
	const host = await std.triple.host();

	// Determine the target triple with differing architecture from the host.
	const hostArch = std.triple.arch(host);
	const targetArch = hostArch === "x86_64" ? "aarch64" : "x86_64";
	const target = std.triple.create({
		arch: targetArch,
		vendor: "unknown",
		os: "linux",
		environment: "gnu",
	});

	const crossRust = await self({ targets: [target] });

	await $`rustc --version && cargo --version`.env(crossRust);
	return crossRust;
});

export const testCargo = tg.command(async () => {
	return await cargo_.test();
});

export const testCargoProxy = tg.command(async () => {
	return await proxy_.test();
});

export const testNativeBuild = tg.command(async () => {
	return await build_.test();
});
