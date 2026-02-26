import * as std from "./tangram.ts";

export * as make from "./bootstrap/make.tg.ts";
export * as musl from "./bootstrap/musl.tg.ts";
export { sdk } from "./bootstrap/sdk.tg.ts";

// Bootstrap release version and GCC version bundled in the Linux toolchain.
const version = "v2026.01.26";
export const gccVersion = "11.2.1";

// Supported macOS SDK versions. The latest is the default.
const sdkVersions = ["12.1", "12.3", "14.5", "15.2", "26.2"] as const;
export type SdkVersion = (typeof sdkVersions)[number];
export const LatestSdkVersion: SdkVersion = "26.2";

export type Arg = {
	/** Specify which component to provide. */
	component?: string | undefined;
	/** Optionally select a system different from the detected host. */
	host?: string | undefined;
};

/** Download all bootstrap components for a host, or a single component. */
export const bootstrap = async (arg?: Arg) => {
	const host = normalizeHost(arg?.host);
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
};

export default bootstrap;

/** Retrieve just the dash component. */
export const dash = (host?: string) => bootstrap({ host, component: "dash" });
export const shell = dash;

/** Retrieve just the env component (Linux only). */
export const env = (host?: string) => {
	const host_ = host ?? std.triple.host();
	if (std.triple.os(host_) !== "linux") {
		throw new Error("The env bootstrap component is only available on Linux.");
	}
	return bootstrap({ host: host_, component: "env" });
};

/** Retrieve just the toolchain component. */
export const toolchain = (host?: string) =>
	bootstrap({ host, component: "toolchain" });

/** Retrieve just the utils component. */
export const utils = (host?: string) => bootstrap({ host, component: "utils" });

/** Retrieve a macOS SDK. */
export const macOsSdk = (version: SdkVersion = LatestSdkVersion) =>
	bootstrap({ component: `macos_sdk_${version}` });

/** The build triple string of the bundled Linux toolchain. */
export const toolchainTriple = (host?: string) => {
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
};

/** Get the interpreter name for a given host. */
export const interpreterName = (host?: string) => {
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
};

/** Apply one or more patches to a directory using the bootstrap utils. */
export const patch = async (
	source: tg.Unresolved<tg.Directory>,
	...patches: Array<tg.Unresolved<tg.File | tg.Symlink>>
) => {
	const source_ = await tg.resolve(source);
	const patches_ = await Promise.all(patches.map(tg.resolve));
	const host = std.triple.host();
	const patchScript = tg.Template.join(
		"\n",
		...patches_.map((p) => tg`patch -p1 < ${p}`),
	);
	return std.build`
		cp -R ${source_} ${tg.output}
		chmod -R +w ${tg.output}
		cd ${tg.output}
		${patchScript}
	`
		.bootstrap(true)
		.env(std.env.arg(utils(host), shell(host), { utils: false }))
		.then(tg.Directory.expect);
};

/** Download a component tarball from the remote host. */
export const remoteComponent = async (name: string) => {
	const checksum = checksums[name];
	tg.assert(checksum, `Unknown component: ${name}.`);
	const url = `https://github.com/tangramdotdev/bootstrap/releases/download/${version}/${name}.tar.zst`;
	return std.download
		.extractArchive({ url, checksum })
		.then(tg.Directory.expect);
};

/** Normalize a host triple to the canonical form used for component names. */
const normalizeHost = (host?: string) => {
	const h = std.triple.archAndOs(host ?? std.triple.host());
	return std.triple.os(h) === "darwin" ? "universal_darwin" : h;
};

/** Enumerate the full set of components for a host. */
export const componentList = (host?: string): Array<string> | undefined => {
	const h = host ?? normalizeHost();
	switch (h) {
		case "aarch64-linux":
		case "x86_64-linux": {
			const suffix = h.replace("-", "_");
			return ["dash", "env", "toolchain", "utils"].map((c) => `${c}_${suffix}`);
		}
		case "aarch64-darwin":
		case "x86_64-darwin":
		case "universal_darwin":
			return [
				"dash_universal_darwin",
				...sdkVersions.map((v) => `macos_sdk_${v}`),
				"toolchain_universal_darwin",
				"utils_universal_darwin",
			];
		case "js":
			return [];
		default:
			return undefined;
	}
};

export const test = async () => {
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
};

const checksums: Record<string, tg.Checksum> = {
	dash_aarch64_linux:
		"sha256:dc5895857027f718e9eaf69f893f355f6cd8957937a6f137bb3c00a7d1f9e70a",
	dash_universal_darwin:
		"sha256:c4d4e24dc4c3e56f5fb4cccec5bf36d07c0422ad3c647a8fed295f2d74ca410e",
	dash_x86_64_linux:
		"sha256:5b07cc4e1c038e53eda90ab9c227648f4b579570d48b9be344664086b8fda503",
	env_aarch64_linux:
		"sha256:7891a449fcc36ebac7f176a22f4c63749a644241416b97b71511300fce1db573",
	env_x86_64_linux:
		"sha256:f5c75ab823a33bbf081b929e8adb715e54220146776a3891a955e8a77db34239",
	"macos_sdk_12.1":
		"sha256:69f73de40e06f9d5ee1ec6b79583646fc568d4b2318a24619189469d19068417",
	"macos_sdk_12.3":
		"sha256:1c51487fd43c51731862a94dae775620f522320db0dd4818607108ddccd0cc80",
	"macos_sdk_14.5":
		"sha256:93bef003b6dbbfc03456749bec6a571d9fabc0c0480cd39394e2080eb853379e",
	"macos_sdk_15.2":
		"sha256:f497d6a7cdaf940af6cd9fdac68b69a5bda1418e4f7e11a4a527bf6f61f17567",
	"macos_sdk_26.2":
		"sha256:4fba68b7c7f1b12a3a10672d112059a9adfe94e866912b463055f12fe342e4f7",
	toolchain_aarch64_linux:
		"sha256:3a7eab3903161eae15cb8f7ff283ea0dcf57c5294f67b4c4306d5fcf7b94e9eb",
	toolchain_universal_darwin:
		"sha256:952bc0fa84feb02a32d2530b425fd7ae82280dec8112edc0e2adfaf7c1f1911e",
	toolchain_x86_64_linux:
		"sha256:58c1b02ce2c770651b574baf2abdd99fe5de0537072d7a25b4da0b7226652480",
	utils_aarch64_linux:
		"sha256:b4724cfba44ea545fb041c61cdd86c0c8fdda1f221bfbe284c23853014faec6d",
	utils_universal_darwin:
		"sha256:8e0031b8c5a183e173fe4b7c2d6b038c46b46f390f6ff5e1d23eb0ec403e2abe",
	utils_x86_64_linux:
		"sha256:552e634483b6d118463bff342febc2b72665c48912e0bf90e80c897cf20b16a9",
};
