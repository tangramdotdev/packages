export * as args from "./args.tg.ts";
export * as assert from "./assert.tg.ts";
export * as autotools from "./autotools.tg.ts";
export * as cc from "./cc.tg.ts";
export { build } from "./process.tg.ts";
export { caCertificates } from "./certificates.tg.ts";
export { command, sh, shBootstrap } from "./command.tg.ts";
export * as dependencies from "./sdk/dependencies.tg.ts";
export { deps } from "./packages.tg.ts";
export { image } from "./image.tg.ts";
export * as directory from "./directory.tg.ts";
export { download } from "./download.tg.ts";
export { env } from "./env.tg.ts";
export * as file from "./file.tg.ts";
export { patch } from "./patch.tg.ts";
export * as packages from "./packages.tg.ts";
export * as phases from "./phases.tg.ts";
export * as pkgconfig from "./pkgconfig.tg.ts";
export { $, run, spawn } from "./process.tg.ts";
export { sdk } from "./sdk.tg.ts";
export * as sdkModule from "./sdk.tg.ts";
export * as triple from "./triple.tg.ts";
export * as utils from "./utils.tg.ts";
export { wrap } from "./wrap.tg.ts";
export { stripProxy } from "./sdk/proxy.tg.ts";
export * as bootstrap from "./bootstrap.tg.ts";
export { test } from "./test.tg.ts";

import * as bootstrap from "./bootstrap.tg.ts";
import * as coreutils from "./utils/coreutils.tg.ts";
import * as dependencies from "./sdk/dependencies.tg.ts";
import * as gettext from "./autotools/gettext.tg.ts";
import * as glibc from "./sdk/libc/glibc.tg.ts";
import * as injection from "./wrap/injection.tg.ts";
import * as pkgconf from "./autotools/pkgconf.tg.ts";
import * as sdk from "./sdk.tg.ts";
import * as triple from "./triple.tg.ts";
import * as utils from "./utils.tg.ts";
import * as workspace from "./wrap/workspace.tg.ts";
import { env as stdEnv } from "./env.tg.ts";

export const metadata = {
	name: "std",
	version: "0.0.0",
	tag: "std/0.0.0",
};

/** Prioritize make, then fetch every upstream source used by the default build. */
export async function prefetchSources(host: string) {
	const os = triple.os(host);
	await bootstrap.make.source();

	const sources: Array<tg.Unresolved<tg.Directory>> = [
		utils.bash.source(),
		utils.bzip2.source(),
		utils.coreutils.source(os),
		utils.diffutils.source(),
		utils.findutils.source(os),
		utils.gawk.source(),
		utils.grep.source(),
		utils.gzip.source(),
		utils.patch.source(),
		utils.sed.source(),
		utils.tar.source(),
		utils.xz.source(),
		pkgconf.source(),
		dependencies.m4.source(),
		dependencies.bison.source(),
		dependencies.flex.source(),
		dependencies.perl.source(os),
		gettext.source(),
	];

	if (os === "linux") {
		sources.push(
			utils.attr.source(),
			dependencies.libxcrypt.source(),
			dependencies.python.source(),
			dependencies.zlib.source(),
			dependencies.zstd.source(),
			dependencies.gmp.source(),
			dependencies.isl.source(),
			dependencies.mpfr.source(),
			dependencies.mpc.source(),
			sdk.gnu.binutils.source(host),
			sdk.gnu.gcc.source(false),
			sdk.kernelHeaders.source(),
			glibc.source(),
		);
	} else if (os === "darwin") {
		sources.push(utils.fileCmds.source(), utils.libiconv.source());
	} else {
		return tg.unreachable(`unsupported host OS: ${os}`);
	}

	await Promise.all(sources);
	return true;
}

/** The default SDK for the detected host. */
export async function default_() {
	return await stdEnv(
		sdk.sdk(), // FIXME - defaultEnv?
		await tg.build(buildAutotoolsBuildTools).named("autotools build tools"),
	);
}

export default default_;

// Export the Rust workspace source directory for use by other packages that depend on tangram_std.
import rustCargoToml from "./Cargo.toml" with { type: "file" };
import rustCargoLock from "./Cargo.lock" with { type: "file" };
import rustPackages from "./packages" with { type: "directory" };
export const rustSource = tg.directory({
	"Cargo.toml": rustCargoToml,
	"Cargo.lock": rustCargoLock,
	packages: rustPackages,
});

export async function buildGnuEnv() {
	return coreutils.gnuEnv();
}

export async function buildDefaultEnv() {
	return utils.defaultEnv();
}

export async function buildDefaultInjection() {
	return injection.defaultInjection();
}

export async function buildDefaultWorkspace() {
	return workspace.defaultWorkspace();
}

export async function buildDefaultWrapper() {
	return workspace.defaultWrapper();
}

export async function buildBootstrapSdkEnv() {
	return bootstrap.sdk.env(triple.host());
}

export async function buildAutotoolsBuildTools() {
	return dependencies.autotoolsBuildTools();
}

export async function buildSdk() {
	const host = sdk.sdk.canonicalTriple(triple.host());
	const resolved = await sdk.sdk.arg({ host });
	return sdk.sdkInner(resolved);
}

export async function buildCrossSdk() {
	const host = sdk.sdk.canonicalTriple(triple.host());
	const os = triple.os(host);
	if (os !== "linux") {
		throw new Error(`${os} is not found in supported hosts for cross SDK`);
	}
	const arch = triple.arch(host);
	const crossArch = arch === "x86_64" ? "aarch64" : "x86_64";
	const crossTarget = sdk.sdk.canonicalTriple(`${crossArch}-linux`);
	const resolved = await sdk.sdk.arg({ host, target: crossTarget });
	return sdk.sdkInner(resolved);
}
