import * as std from "./tangram.ts";

export * as make from "./bootstrap/make.tg.ts";
export * as musl from "./bootstrap/musl.tg.ts";
export { sdk, toolchainSdk } from "./bootstrap/sdk.tg.ts";

// Bootstrap release version and GCC version bundled in the Linux toolchain.
const version = "v2026.07.29";
export const gccVersion = "11.2.1";

// Supported macOS SDK versions. The latest is the default.
const sdkVersions = ["12.1", "14.5", "15.2", "15.4", "26.5"] as const;
export type SdkVersion = (typeof sdkVersions)[number];
export const LatestSdkVersion: SdkVersion = "26.5";

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
export async function macOsSdk(version: SdkVersion = LatestSdkVersion) {
	const inner = await bootstrap({ component: `macos_sdk_${version}` });
	return tg.directory({ "MacOSX.sdk": inner });
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

/** Apply one or more patches to a directory using the bootstrap utils. */
export async function patch(
	source: tg.Unresolved<tg.Directory>,
	...patches: Array<tg.Unresolved<tg.File | tg.Symlink>>
) {
	const source_ = await tg.resolve(source);
	const patches_ = await Promise.all(patches.map(tg.resolve));
	const host = std.triple.host();
	const patchScript = tg.Template.join(
		"\n",
		...patches_.map((p) => tg`patch -p1 < ${p}`),
	);
	return std
		.build(std.shBootstrap`
		cp -R ${source_} ${tg.output}
		chmod -R +w ${tg.output}
		cd ${tg.output}
		${patchScript}
	`)
		.env(utils(host))
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
	const h = std.triple.archAndOs(host ?? std.triple.host());
	return std.triple.os(h) === "darwin" ? "universal_darwin" : h;
}

/** Enumerate the full set of components for a host. */
export function componentList(host?: string): Array<string> | undefined {
	const h = host ?? normalizeHost();
	switch (h) {
		case "aarch64-linux":
		case "x86_64-linux": {
			const suffix = h.replace("-", "_");
			return ["toolchain", "utils"].map((c) => `${c}_${suffix}`);
		}
		case "aarch64-darwin":
		case "x86_64-darwin":
		case "universal_darwin":
			return [
				...sdkVersions.map((v) => `macos_sdk_${v}`),
				"toolchain_universal_darwin",
				"utils_universal_darwin",
			];
		case "js":
			return [];
		default:
			return undefined;
	}
}

export async function test() {
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

const checksums: Record<string, tg.Checksum> = {
	"macos_sdk_12.1":
		"sha256:60cb0bf7c1dfd0d690fbadc58f9e0750a31a4079e3f2ec367d41d3f3f0249aaa",
	"macos_sdk_14.5":
		"sha256:04cceb8affaee0319d3985611e88735fb05a4cd1517b936b77e8d8ee2af69a1c",
	"macos_sdk_15.2":
		"sha256:d026cae566358af13c581bfc9bc7e7766048ea2acbdf8d2d5c4ebe880fe3088c",
	"macos_sdk_15.4":
		"sha256:db62998e3d1aeaacf631785fe32433e8f74bb7205345ed328e7483e91329ef05",
	"macos_sdk_26.5":
		"sha256:5efe322cf20d89d3e2aed633407aa1c85606ec14e6dae5defbee1fee6bb098da",
	toolchain_aarch64_linux:
		"sha256:d0d01924d0542cf54b187f7e294fb2f995b4e0ee16815d03ee182f07e16e07e3",
	toolchain_universal_darwin:
		"sha256:165f267d834d07f07a512c6932776ac4b35e36781c5a3271dafd7c42921797b4",
	toolchain_x86_64_linux:
		"sha256:f688005853cd8c15cb9371e7d320049387b951aca961ebd7be5d724e25d8fb22",
	utils_aarch64_linux:
		"sha256:0f5df376109c8c5acd1efc4989e83608cea57d21d8a31d9804f145f2a96cba8b",
	utils_universal_darwin:
		"sha256:44649125995ade83db7e4f745876492ca877cfc2ed47aad85e792d4f5bcc27c1",
	utils_x86_64_linux:
		"sha256:de8db84ba59a38b82dd963747b4c466aabd352d81a46d11c405d1ef1379992fd",
};
