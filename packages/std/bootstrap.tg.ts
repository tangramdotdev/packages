import { download } from "./tangram.tg.ts";
import * as triple from "./triple.tg.ts";

export * as make from "./bootstrap/make.tg.ts";
export * as musl from "./bootstrap/musl.tg.ts";
export { sdk } from "./bootstrap/sdk.tg.ts";

export type Arg = {
	/** Specify which component to provide. */
	component?: string | undefined;
	/** Optionally select a system different from the detected host. */
	host?: string | undefined;
};

export let bootstrap = async (arg?: Arg) => {
	let host = triple.archAndOs(arg?.host ?? (await triple.host()));
	if (triple.os(host) === "darwin") {
		host = "universal_darwin";
	}
	let hostFilename = arg?.component?.includes("sdk")
		? undefined
		: host?.replace("-", "_");
	if (!arg?.component) {
		// Download all and aggregate.
		let allComponents = await componentList({ host });
		tg.assert(allComponents);
		let dirObject = allComponents.reduce(
			(acc, name) => {
				acc[name] = remoteComponent(name);
				return acc;
			},
			{} as Record<string, Promise<tg.Directory>>,
		);
		return tg.directory(dirObject);
	}
	let requestedComponentName = hostFilename
		? `${arg.component}_${hostFilename}`
		: arg.component;
	return remoteComponent(requestedComponentName);
};

export default bootstrap;

/** Retrieve just the dash component. */
export let dash = (host?: string) => {
	return bootstrap({ host, component: "dash" });
};
export let shell = dash;

/** Retrieve just the toolchain component. */
export let toolchain = (host?: string) => {
	return bootstrap({ host, component: "toolchain" });
};

/** Retrieve just the utils component. */
export let utils = (host?: string) => {
	return bootstrap({ host, component: "utils" });
};

/** Get the GCC version bundled for the Linux toolchain. */
export let gccVersion = "11.2.1";

/** The build triple string of the bundled Linux toolchain. */
export let toolchainTriple = async (hostArg?: string) => {
	let host = hostArg ?? (await triple.host());
	let system = triple.archAndOs(host);
	let arch = triple.arch(system);

	let os = triple.os(system);
	if (os === "linux") {
		return `${arch}-linux-musl`;
	} else if (os === "darwin") {
		return `${arch}-apple-darwin`;
	} else {
		return tg.unreachable();
	}
};

/** Get the interpreter name for a given host. */
export let interpreterName = async (hostArg?: string) => {
	let host = hostArg ?? (await triple.host());
	let system = triple.archAndOs(host);
	switch (system) {
		case "x86_64-linux": {
			return "ld-musl-x86_64.so.1";
		}
		case "aarch64-linux": {
			return "ld-musl-aarch64.so.1";
		}
		case "x86_64-darwin":
		case "aarch64-darwin": {
			return "none";
		}
		default: {
			return tg.unreachable();
		}
	}
};

export type SdkVersion = "12" | "12.1" | "12.3" | "13" | "13.3" | "14" | "14.4";
export let LatestSdkVersion: SdkVersion = "14.4" as const;

/** Retrieve a single version of the MacOSSDK */
export let macOsSdk = (versionArg?: SdkVersion) => {
	let version = versionArg ?? LatestSdkVersion;
	// NOTE - the host doesn't matter, any host can request this component.
	return bootstrap({ component: `macos_sdk_${version}` });
};

/** Apply one or more patches to a directory using the bootstrap utils. */
export let patch = async (
	source: tg.Directory,
	...patches: Array<tg.File | tg.Symlink>
) => {
	let host = await triple.host();

	let patchScript = tg.Template.join(
		"\n",
		...patches.map((patch) => tg`patch -p1 < ${patch}`),
	);

	let script = tg`
		cp -R ${source} $OUTPUT
		chmod -R +w $OUTPUT
		cd $OUTPUT
		${patchScript}
	`;

	let shellArtifact = await shell(host);
	let shellExecutable = await shellArtifact
		.get("bin/dash")
		.then(tg.File.expect);
	let utilsArtifact = utils(host);

	let patchedSource = tg.Directory.expect(
		await (
			await tg.target({
				executable: shellExecutable,
				args: ["-eu", "-c", script],
				env: {
					PATH: tg`${utilsArtifact}/bin:${shellArtifact}/bin`,
				},
				host,
			})
		).output(),
	);

	return patchedSource;
};

/** Download a component tarball from the remote host. */
export let remoteComponent = async (componentName: string) => {
	let version = "v2024.04.02";
	let url = `https://github.com/tangramdotdev/bootstrap/releases/download/${version}/${componentName}.tar.zst`;
	let checksum = checksums[componentName];
	tg.assert(checksum, `Could not locate checksum for ${componentName}.`);

	// Download and extract the selected tarball.
	return await download({ url, checksum }).then(tg.Directory.expect);
};

/** Enumerate the full set of components for a host. */
export let componentList = async (arg?: Arg) => {
	let host = arg?.host ?? (await triple.host());

	let linuxComponents = (hostTriple: string) => {
		let host = hostTriple.replace("-", "_");
		return [
			`dash_${host}`,
			`env_${host}`,
			`toolchain_${host}`,
			`utils_${host}`,
		];
	};
	let darwinComponents = [
		"dash_universal_darwin",
		"macos_sdk_12.1",
		"macos_sdk_12.3",
		"macos_sdk_13.3",
		"macos_sdk_14.4",
		"toolchain_universal_darwin",
		"utils_universal_darwin",
	];
	let expectedComponents: { [key: string]: Array<string> } = {
		["aarch64-darwin"]: darwinComponents,
		["aarch64-linux"]: linuxComponents("aarch64-linux"),
		["js"]: [],
		["universal_darwin"]: darwinComponents,
		["x86_64-darwin"]: darwinComponents,
		["x86_64-linux"]: linuxComponents("x86_64-linux"),
	};

	return expectedComponents[host];
};

export let test = tg.target(async () => {
	let host = await triple.host();
	// Assert that all expected components exist and provide a non-empty `bin/` subdirectory.
	let components = await componentList({ host });
	tg.assert(components);
	tg.assert(
		(
			await Promise.all(
				components.map(async (component) =>
					(await bootstrap()).tryGet(component).then(async (artifact) => {
						// Assert that the component exists.
						tg.assert(artifact);
						tg.Directory.assert(artifact);
						// Return whether there are entries in the component.
						let entries = await artifact.entries();
						let binariesNotEmpty = Object.keys(entries).length > 0;
						return binariesNotEmpty;
					}),
				),
			)
		).every((result) => result),
	);
	return true;
});

let checksums: Record<string, tg.Checksum> = {
	"macos_sdk_12.1":
		"sha256:f43a9d4923dd06b74c1c9777743e44fffcbbdd5e7cbb6a66133c302b9742f01f",
	"macos_sdk_12.3":
		"sha256:6aff63af47ea70a285109448e0d7565d7f9855d8d7bf0b54144a853e0649025e",
	"macos_sdk_13.3":
		"sha256:b7960164aea7559d2c4dfcb10ea9a1c9a2658c12d3fc420b6f4f4658a7e795be",
	"macos_sdk_14.4":
		"sha256:fd3668ea4091c7f0d851016b18916b924900a253bf8dc28a6178bb44a1367833",
	dash_aarch64_linux:
		"sha256:89a1cab57834f81cdb188d5f40b2e98aaff2a5bdae4e8a5d74ad0b2a7672d36b",
	dash_universal_darwin:
		"sha256:738409d7788da5a278cd58a43d6d0780be48a1a4d13ef6b87752472591ba5e41",
	dash_x86_64_linux:
		"sha256:899adb46ccf4cddc7bfeb7e83a6b2953124035c350d6f00f339365e3b01b920e",
	env_aarch64_linux:
		"sha256:da4fed85cc4536de95b32f5a445e169381ca438e76decdbb4f117a1d115b0184",
	env_x86_64_linux:
		"sha256:ea7b6f8ffa359519660847780a61665bb66748aee432dec8a35efb0855217b95",
	toolchain_aarch64_linux:
		"sha256:80dc8b9a596560959f074d18332143651132a147da9abbaf389b661d907c4d9e",
	toolchain_universal_darwin:
		"sha256:6f2ea271a02d7306e15c01d6d97f56fea91e3115cc0be9fb1e3db24bd2d07051",
	toolchain_x86_64_linux:
		"sha256:c70eb26d7664629a43c7a6fb91ef26578136e4da8a0d2b6e781c408616627551",
	utils_aarch64_linux:
		"sha256:f28077625374178017850db30c19b051dfbc9dad618d0b76394d3729b2a8eb25",
	utils_universal_darwin:
		"sha256:ccce6e34dc673c540d976020c1a0fcc05aa21638df370b12852a2aea80bee345",
	utils_x86_64_linux:
		"sha256:96fb55fe25af716219cbf6247fd7345ab651ccc376e984f9279a37801c7f5dfe",
};
