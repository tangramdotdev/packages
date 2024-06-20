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

export type SdkVersion =
	| "12"
	| "12.1"
	| "12.3"
	| "13"
	| "13.3"
	| "14"
	| "14.4"
	| "14.5";
export let LatestSdkVersion: SdkVersion = "14.5" as const;

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
	let version = "v2024.06.20";
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
		"macos_sdk_14.5",
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
		"sha256:ec34c2b06b3e19829a101d34283ad6fab48481959a918ceb0583ce833075aede",
	"macos_sdk_12.3":
		"sha256:fc19d39cb3bb4eb289a71c140f5b7b4de1c0d0b858fa6936ead47074becde4f6",
	"macos_sdk_13.3":
		"sha256:0d2778863846b8c88fd6a26828d046c92e2f001c70459164a9fb214111d6454a",
	"macos_sdk_14.4":
		"sha256:11ac6a0b5a295238d215e68313d7d2a46485efafbb7a6106e495398bfd8dfc6a",
	"macos_sdk_14.5":
		"sha256:afc30888af86c1b4f80ea095c6ba2d580309ac016559e067e710682aebc233db",
	dash_aarch64_linux:
		"sha256:7fd88a5e0e6800424b4ed36927861564eea99699ede9f81bc12729ec405ac193",
	dash_universal_darwin:
		"sha256:d522cdef681f13a0f66e78a69db00e08b7c00bd2e65b967d52aa39e73b890add",
	dash_x86_64_linux:
		"sha256:42afecad2eadf0d07745d9a047743931b270f555cc5ab8937f957e85e040dc02",
	env_aarch64_linux:
		"sha256:a3497e17fac0fb9fa8058157b5cd25d55c5c8379e317ce25c56dfd509d8dc4b4",
	env_x86_64_linux:
		"sha256:78a971736d9e66c7bdffa81a24a7f9842b566fdd1609fe7c628ac00dccc16dda",
	toolchain_aarch64_linux:
		"sha256:6621ba7a5d6510e9db2e280fd4b69671e76398fa68fb4fb3740d1e4f332d463d",
	toolchain_universal_darwin:
		"sha256:7e5fd46f48d346bc3130495d7c083c643e52eeca200dd379c7b53e41051358f4",
	toolchain_x86_64_linux:
		"sha256:63f543aac32a67b8cdd1c3274980db0495ba442d0763fdae9fc21e9af5ba4e19",
	utils_aarch64_linux:
		"sha256:45e5be2f4282d6f90a60516c0905ac72c630512918887762f8c74dbf2345cd54",
	utils_universal_darwin:
		"sha256:df10a8674a990d07f475da2f91777ab18e775181e64280bce2e2675ce6121515",
	utils_x86_64_linux:
		"sha256:4f69691d0976110088c0fd1019015a69d08493a7fcf4509f2484715ac1d11f1f",
};
