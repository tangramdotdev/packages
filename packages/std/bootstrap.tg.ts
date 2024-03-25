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
	} else {
		host = host.replace("-", "_");
	}
	let requestedComponentName = `${component}_${host}`;
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

export type SdkVersion = "12" | "12.1" | "12.3" | "13" | "13.3" | "14" | "14.2";
export let LatestSdkVersion: SdkVersion = "14.2" as const;

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
export let remoteComponent = tg.target(async (componentName: string) => {
	let version = "v2023.12.14";
	let url = `https://github.com/tangramdotdev/bootstrap/releases/download/${version}/${componentName}.tar.zstd`;
	let checksum = checksums[componentName];
	tg.assert(checksum, `Could not locate checksum for ${componentName}.`);

	// Download and extract the selected tarball.
	let unpackFormat = ".tar.zst" as const;
	let contents = tg.Directory.expect(
		await download({ url, checksum, unpackFormat }),
	);

	return contents;
});

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
		"sdk_14.2_universal_darwin",
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
		"sha256:9a7ec25421e58c0568ab0c10d86e89d0b2464a86ef942578278cf68a7e2d877d",
	"sdk_12.3_universal_darwin":
		"sha256:394b4f35693f8261fa70eada0248708ff22a58ae39150824fa010804462a3024",
	"sdk_13.3_universal_darwin":
		"sha256:261d96948b8a166f7fe063f3d551cea251d4b654a29eb238ee4db97128908b8e",
	"sdk_14.2_universal_darwin":
		"sha256:0c6b05bcc0703d0b5dee32a1b22c15643b47351d2659e01f4cb077d94837dec9",
	dash_aarch64_linux:
		"sha256:b9af1af51017b6def5a44dea2e80b374ab7d92b71bc296b7aaa2c6081f8ef86a",
	dash_universal_darwin:
		"sha256:f47427cae8b36e1c65894911c4f2621e055d834190f19f507c28905c087d05ea",
	dash_x86_64_linux:
		"sha256:a5230a7495324814bbb37202ed6f7eca9cc0f088c48451dbac9b2a8c9cca0b90",
	env_aarch64_linux:
		"sha256:ef064e25dd0dc65c9b3f7118bdaf3b9e6674d50065f533518e1e0dbc1063f636",
	env_x86_64_linux:
		"sha256:bf15ef9d8c5d55dbf38435b07c59c6fac557c620ef15e82421301c644803b8dd",
	toolchain_aarch64_linux:
		"sha256:53023087f99196ed05ca5e8ca67fca6c0ecde572ef6fdf25525eccaa6d39312d",
	toolchain_universal_darwin:
		"sha256:b4adbbff5c6ca67ec1bd68b0f424bb96d50aa3c59390c5a9542b3a00bf1607e2",
	toolchain_x86_64_linux:
		"sha256:270171f1403f7026dd5be9b5b711b174d3053eb45c3754d33fc18a5703a300e1",
	utils_aarch64_linux:
		"sha256:5a11d2ecc3368ad8cf75852897bb4cc0668cc23f9bdf34a847ba4d5bfb5ea5fb",
	utils_universal_darwin:
		"sha256:ce1bb45c60d60fd4470a10ab97eba1cc137cf193afe6147d4e1c5257a5c7aa6b",
	utils_x86_64_linux:
		"sha256:82ab2d025870670cd9a317fd9b0ef58b81d9a6f14a0494597c4ee8a5bfe3b13a",
};
