import * as std from "./tangram.ts";
import { sdk as bootstrapSdk } from "./bootstrap/sdk.tg.ts";
import gnuPatchBuild from "./utils/patch.tg.ts";

export * as make from "./bootstrap/make.tg.ts";
export * as musl from "./bootstrap/musl.tg.ts";
export { sdk, toolchainSdk } from "./bootstrap/sdk.tg.ts";

// Bootstrap release version and GCC version bundled in the Linux toolchain.
const version = "v2026.09.16";
export const gccVersion = "11.2.1";

// Supported macOS SDK versions.
const sdkVersions = ["12.1", "14.5", "15.2", "26.5", "27.0"] as const;
export type SdkVersion = (typeof sdkVersions)[number];
export const LatestSdkVersion: SdkVersion = "27.0";

export type Arg = {
	/** Specify which component to provide. */
	component?: string | null;
	/** Optionally select a system different from the detected host. */
	host?: string | null;
};

/** Download all bootstrap components for a host, or a single component. */
export async function bootstrap(arg?: Arg) {
	const host = normalizeHost(arg?.host ?? undefined);
	if (!arg?.component) {
		const components = componentList(host);
		if (!components) {
			throw new Error(`Unknown host: ${host}.`);
		}
		const entries = Object.fromEntries(
			components.map((name) => [name, remoteComponent(name)]),
		);
		return tg.directory(entries);
	}
	const name = arg.component.includes("sdk")
		? arg.component
		: `${arg.component}_${host.replace("-", "_")}`;
	return remoteComponent(name);
}

export default bootstrap;

/** Retrieve just the toolchain component. */
export function toolchain(host?: string) {
	return bootstrap({ host: host ?? null, component: "toolchain" });
}

/** Retrieve just the utils component. */
export function utils(host?: string) {
	return bootstrap({ host: host ?? null, component: "utils" });
}

/** Retrieve a macOS SDK wrapped under a `MacOSX.sdk/` subdirectory. */
export async function macOsSdk(version?: SdkVersion, host?: string) {
	version ??= defaultMacOsSdkVersion(host);
	const inner = await bootstrap({ component: `macos_sdk_${version}` });
	return tg.directory({ "MacOSX.sdk": inner });
}

/** Select the SDK for the machine running the compiler, including cross-compilers. */
export function defaultMacOsSdkVersion(host = std.triple.host()): SdkVersion {
	return std.triple.archAndOs(host) === "x86_64-darwin"
		? "26.5"
		: LatestSdkVersion;
}

/** The build triple string of the bundled Linux toolchain. */
export function toolchainTriple(host?: string) {
	const system = std.triple.archAndOs(host ?? std.triple.host());
	const arch = std.triple.arch(system);
	const os = std.triple.os(system);
	switch (os) {
		case "linux":
			return `${arch}-linux-musl`;
		case "darwin":
			return `${arch}-apple-darwin`;
		default:
			return tg.unreachable();
	}
}

/** Get the interpreter name for a given host. */
export function interpreterName(host?: string) {
	const system = std.triple.archAndOs(host ?? std.triple.host());
	const arch = std.triple.arch(system);
	const os = std.triple.os(system);
	switch (os) {
		case "linux":
			return `ld-musl-${arch}.so.1`;
		case "darwin":
			return "none";
		default:
			return tg.unreachable();
	}
}

/** Apply one or more patches to a directory using the bootstrap utils.
 *
 * The bootstrap utils supply a minimal `patch` that supports no fuzz, so it
 * rejects any hunk whose context has drifted from the patch. Prefer `patchGnu`
 * unless the caller sits inside GNU patch's own dependency cone.
 */
export async function patch(
	source: tg.Unresolved<tg.Directory>,
	...patches: Array<tg.Unresolved<tg.File | tg.Symlink>>
) {
	return patchInner(undefined, source, patches);
}

/** Apply one or more patches to a directory using GNU patch from `std.utils`.
 *
 * This must not be called from within GNU patch's own dependency cone, which
 * includes `std.utils.coreutils` and `std.utils.prerequisites`. GNU patch is
 * built with those, so patching their sources this way creates an unresolvable
 * cycle. Those call sites must continue to use `patch`.
 */
export async function patchGnu(
	source: tg.Unresolved<tg.Directory>,
	...patches: Array<tg.Unresolved<tg.File | tg.Symlink>>
) {
	const host = std.triple.host();
	// Build GNU patch the way `std.utils.env` does, so the two share a build.
	const env = await std.env.compose(await bootstrapSdk(host));
	const gnuPatch = await tg
		.build(gnuPatchBuild, { build: null, env, host, sdk: "none" })
		.named("patch");
	return patchInner(gnuPatch, source, patches);
}

/** Apply patches, optionally overriding the `patch` command from the bootstrap utils. */
async function patchInner(
	patchEnv: std.env.Arg | undefined,
	source: tg.Unresolved<tg.Directory>,
	patches: Array<tg.Unresolved<tg.File | tg.Symlink>>,
) {
	const source_ = await tg.resolve(source);
	const patches_ = await Promise.all(patches.map(tg.resolve));
	const host = std.triple.host();
	const patchScript = tg.Template.join(
		"\n",
		...patches_.map((p) => tg`patch -p1 < ${p}`),
	);
	// Order matters: items later in the list prepend to PATH later, so they
	// appear first. Any override must follow the bootstrap utils to take effect.
	const env = std.env.compose(utils(host), patchEnv ?? null);
	return std
		.build(std.shBootstrap`
		cp -R ${source_} ${tg.output}
		chmod -R +w ${tg.output}
		cd ${tg.output}
		${patchScript}
	`)
		.env(env)
		.then(tg.Directory.expect);
}

/** Download a component tarball from the remote host. */
export async function remoteComponent(name: string) {
	const checksum = checksums[name];
	tg.assert(checksum, `Unknown component: ${name}.`);
	const url = `https://github.com/tangramdotdev/bootstrap/releases/download/${version}/${name}.tar.zst`;
	return std.download
		.extractArchive({ url, checksum })
		.then(tg.Directory.expect);
}

/** Normalize a host triple to the canonical form used for component names. */
function normalizeHost(host?: string) {
	return std.triple.archAndOs(host ?? std.triple.host());
}

/** Enumerate the full set of components for a host. */
export function componentList(host?: string): Array<string> | undefined {
	const h = host === "js" ? host : normalizeHost(host);
	switch (h) {
		case "aarch64-linux":
		case "x86_64-linux": {
			const suffix = h.replace("-", "_");
			return ["toolchain", "utils"].map((c) => `${c}_${suffix}`);
		}
		case "aarch64-darwin":
		case "x86_64-darwin": {
			const suffix = h.replace("-", "_");
			return [
				...sdkVersions.map((v) => `macos_sdk_${v}`),
				`toolchain_${suffix}`,
				`utils_${suffix}`,
			];
		}
		case "js":
			return [];
		default:
			return undefined;
	}
}

export async function test() {
	testSelection();
	const host = std.triple.host();
	const components = componentList(host);
	if (!components) {
		throw new Error(`Unknown host: ${host}.`);
	}
	const all = await bootstrap({ host });
	for (const name of components) {
		const artifact = await all.tryGet(name);
		tg.assert(artifact, `Missing component: ${name}.`);
		tg.Directory.assert(artifact);
		const entries = await artifact.entries;
		tg.assert(Object.keys(entries).length > 0, `Empty component: ${name}.`);
	}
	return true;
}

export function testSelection() {
	tg.assert(componentList("js")?.length === 0);
	for (const [host, sdkVersion] of [
		["aarch64-apple-darwin", "27.0"],
		["x86_64-apple-darwin", "26.5"],
		["aarch64-unknown-linux-gnu", "27.0"],
		["x86_64-unknown-linux-musl", "27.0"],
	] as const) {
		const suffix = std.triple.archAndOs(host).replace("-", "_");
		const components = componentList(host);
		tg.assert(components?.includes(`toolchain_${suffix}`));
		tg.assert(components?.includes(`utils_${suffix}`));
		tg.assert(components.every((name) => checksums[name] !== undefined));
		tg.assert(defaultMacOsSdkVersion(host) === sdkVersion);
	}
	return true;
}

const checksums: Record<string, tg.Checksum> = {
	"macos_sdk_12.1":
		"sha256:3f2d3ac24930f9422a59f29d7a9c70d72433e2b62082af4ec0d3ced21d0aab9c",
	"macos_sdk_14.5":
		"sha256:3fa3e0bdc49b0411bc49ec6b64ec290d7e06428c51f0a5ab5098e1ea7cef4a57",
	"macos_sdk_15.2":
		"sha256:0e3684e94e08a9053470db72c2a23e4ae8e44a886385ee21a37db95a95940032",
	"macos_sdk_26.5":
		"sha256:9ce8d514ec9c82efd18bf7ec4f06330368580dfe6440c83c665e87bcb6e83694",
	"macos_sdk_27.0":
		"sha256:fea5b356d1a7480d459d9f40f6945823a83dc17f8fa16f58f1fba15b34e4c9ed",
	toolchain_aarch64_darwin:
		"sha256:917cbc227e5c2b04229a02239ce6dc42bdcfeb56d87f1ed9eda96cd8bf340b52",
	toolchain_aarch64_linux:
		"sha256:d0d01924d0542cf54b187f7e294fb2f995b4e0ee16815d03ee182f07e16e07e3",
	toolchain_x86_64_darwin:
		"sha256:00c6d34df2bfa9fa9ca1daba8fd384f4635e404689ad932a6e481e48ccbcc275",
	toolchain_x86_64_linux:
		"sha256:f688005853cd8c15cb9371e7d320049387b951aca961ebd7be5d724e25d8fb22",
	utils_aarch64_darwin:
		"sha256:164b27c527541c1695d0ad9ca5ccb65b495315770ca2916c9c2b7f691d002dc4",
	utils_aarch64_linux:
		"sha256:452a996d74030a74f1b7de3a022cc7710a5ad216bb8fb1ac967544b0db632260",
	utils_x86_64_darwin:
		"sha256:10b0cf8ca64429f4362f8aaded78326d418db8a1d4d7f2fa91a5f8019dbb49de",
	utils_x86_64_linux:
		"sha256:1c555946f1a69253c6e6b5ae9152ee2c45629ebd047ba2e471c64ee79d8dbbff",
};
