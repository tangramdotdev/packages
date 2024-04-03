import { download } from "./tangram.tg.ts";
import * as triple from "./triple.tg.ts";

export * as make from "./bootstrap/make.tg.ts";
export * as musl from "./bootstrap/musl.tg.ts";
export * as sdk from "./bootstrap/sdk.tg.ts";

export type Arg = {
	/** Specify which component to provide. */
	component?: string;
	/** Optionally select a system different from the detected host. */
	host?: string;
};

export let bootstrap = async (arg?: Arg) => {
	let { component, host } = await configure(arg);
	if (triple.os(host) === "darwin") {
		host = "universal_darwin";
	}
	if (!component) {
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
	let requestedComponentName = `${component}_${host.replace("-", "_")}`;
	return remoteComponent(requestedComponentName);
};

export default bootstrap;

/** Retrieve just the dash component. */
export let dash = (arg?: Arg) => {
	let config = configureComponent(arg);
	return bootstrap({ ...config, component: "dash" });
};
export let shell = dash;

/** Retrieve just the toolchain component. */
export let toolchain = (arg?: Arg) => {
	let config = configureComponent(arg);
	return bootstrap({ ...config, component: "toolchain" });
};

/** Get the GCC version bundled for the Linux toolchain. */
export let gccVersion = "11.2.1";

/** The build triple string of the bundled Linux toolchain. */
export let toolchainTriple = (host: string) => {
	let system = configureSystem(host);
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
export let interpreterName = (host: string) => {
	let system = configureSystem(host);
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

/** Retrieve just the utils component. */
export let utils = (arg?: Arg) => {
	let config = configureComponent(arg);
	return bootstrap({ ...config, component: "utils" });
};

export type SdkVersion = "12" | "12.1" | "12.3" | "13" | "13.3" | "14" | "14.4";
export let LatestSdkVersion: SdkVersion = "14.4" as const;

type SdkArg = {
	/** Specify the version of the macOS SDK to use. Omit this argument to use the latest version, or pass `"none"` to not include an SDK. */
	version?: SdkVersion;
};

/** Retrieve a single version of the MacOSSDK */
export let macOsSdk = (arg?: SdkArg) => {
	let version = arg?.version ?? LatestSdkVersion;
	// NOTE - the host doesn't matter, any host can request this component.
	return bootstrap({ component: `sdk_${version}`, host: "aarch64-darwin" });
};

type Config = {
	component?: string;
	host: string;
	remote: boolean;
};

/** Resolve optional system arguments to  */
export let configure = async (arg?: Arg): Promise<Config> => {
	let componentConfig = await configureComponent(arg);
	let component = arg?.component ?? undefined;
	return { ...componentConfig, component };
};

type ComponentArg = {
	/** Optionally select a system different from the detected host. */
	host?: string;
	/** Optionally download components from remote hosting instead of including local files. */
	remote?: boolean;
};

type ComponentConfig = {
	host: string;
	remote: boolean;
};

/** Resolve optional values for a component arg. */
export let configureComponent = async (
	arg?: ComponentArg,
): Promise<ComponentConfig> => {
	let host = configureSystem(arg?.host ?? (await triple.host()));

	if (arg?.remote === false) {
		throw new Error("Local source is not yet implemented.");
	}

	let remote = true;
	return { host, remote };
};

/** This package cannot access `std`. This helper allows users to pass `triple` objects for the host. */
export let configureSystem = (arg: string): string => {
	return triple.archAndOs(arg);
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
		cp -R ${source} $OUTPUT | true
		chmod -R +w $OUTPUT
		cd $OUTPUT
		${patchScript}
	`;

	let shellArtifact = await shell({ host });
	let shellExecutable = tg.File.expect(await shellArtifact.get("bin/dash"));
	let utilsArtifact = utils({ host });

	let patchedSource = tg.Directory.expect(
		await tg.build({
			executable: shellExecutable,
			args: ["-eu", "-c", script],
			env: {
				PATH: tg`${utilsArtifact}/bin:${shellArtifact}/bin`,
			},
			host,
		}),
	);

	return patchedSource;
};

/** Download a component tarball from the remote host. */
export let remoteComponent = async (componentName: string) => {
	let version = "v2024.04.02";
	let unpackFormat = ".tar.zst" as const;
	let url = `https://github.com/tangramdotdev/bootstrap/releases/download/${version}/${componentName}${unpackFormat}`;
	let checksum = checksums[componentName];
	tg.assert(checksum, `Could not locate checksum for ${componentName}.`);

	// Download and extract the selected tarball.
	return tg.Directory.expect(await download({ url, checksum, unpackFormat }));
};

/** Enumerate the full set of components for a host. */
export let componentList = async (arg?: Arg) => {
	let { host } = await configureComponent(arg);

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
		"sdk_12.1_universal_darwin",
		"sdk_12.3_universal_darwin",
		"sdk_13.3_universal_darwin",
		"sdk_14.4_universal_darwin",
		"toolchain_universal_darwin",
		"utils_universal_darwin",
	];
	let expectedComponents: { [key: string]: Array<string> } = {
		["aarch64-darwin"]: darwinComponents,
		["aarch64-linux"]: linuxComponents("aarch64-linux"),
		["js"]: [],
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
			await tg.resolve(
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
	"sdk_12.1_universal_darwin":
		"sha256:bc053e15004a8aabfa236e515ed6deb9161906abb8a01862e9a72f529e0df83b",
	"sdk_12.3_universal_darwin":
		"sha256:16ab0c38c0817b805511b729c8ef070dc0e60e81b6a0c28600f004597b1e9297",
	"sdk_13.3_universal_darwin":
		"sha256:95c16a2cda5a68451d1ed9464d3c3bb8d5f2d484406e12f714e24214de4e7871",
	"sdk_14.4_universal_darwin":
		"sha256:bdf2ff1a471c4a47c5676a116eaa9534c78912aee26999f3d8dd075d43c295b1",
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
