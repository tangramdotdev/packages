import * as std from "./tangram.ts";

export * as make from "./bootstrap/make.tg.ts";
export * as musl from "./bootstrap/musl.tg.ts";
export { sdk } from "./bootstrap/sdk.tg.ts";

export type Arg = {
	/** Specify which component to provide. */
	component?: string | undefined;
	/** Optionally select a system different from the detected host. */
	host?: string | undefined;
};

export const bootstrap = async (arg?: Arg) => {
	let host = std.triple.archAndOs(arg?.host ?? (await std.triple.host()));
	if (std.triple.os(host) === "darwin") {
		host = "universal_darwin";
	}
	const hostFilename = arg?.component?.includes("sdk")
		? undefined
		: host?.replace("-", "_");
	if (!arg?.component) {
		// Download all and aggregate.
		const allComponents = await componentList({ host });
		tg.assert(allComponents);
		const dirObject = allComponents.reduce(
			(acc, name) => {
				acc[name] = remoteComponent(name);
				return acc;
			},
			{} as Record<string, Promise<tg.Directory>>,
		);
		return tg.directory(dirObject);
	}
	const requestedComponentName = hostFilename
		? `${arg.component}_${hostFilename}`
		: arg.component;
	return remoteComponent(requestedComponentName);
};

export default bootstrap;

/** Retrieve just the dash component. */
export const dash = (host?: string) => {
	return bootstrap({ host, component: "dash" });
};
export const shell = dash;

/** Retrieve just the toolchain component. */
export const toolchain = (host?: string) => {
	return bootstrap({ host, component: "toolchain" });
};

/** Retrieve just the utils component. */
export const utils = (host?: string) => {
	return bootstrap({ host, component: "utils" });
};

/** Get the GCC version bundled for the Linux toolchain. */
export const gccVersion = "11.2.1";

/** The build triple string of the bundled Linux toolchain. */
export const toolchainTriple = async (hostArg?: string) => {
	const host = hostArg ?? (await std.triple.host());
	const system = std.triple.archAndOs(host);
	const arch = std.triple.arch(system);

	const os = std.triple.os(system);
	if (os === "linux") {
		return `${arch}-linux-musl`;
	} else if (os === "darwin") {
		return `${arch}-apple-darwin`;
	} else {
		return tg.unreachable();
	}
};

/** Get the interpreter name for a given host. */
export const interpreterName = async (hostArg?: string) => {
	const host = hostArg ?? (await std.triple.host());
	const system = std.triple.archAndOs(host);
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

export type SdkVersion = "12.1" | "12.3" | "14.5" | "15.1" | "15.2";

export const LatestSdkVersion: SdkVersion = "15.2" as const;

/** Retrieve a single version of the MacOSSDK */
export const macOsSdk = (versionArg?: SdkVersion) => {
	const version = versionArg ?? LatestSdkVersion;
	// NOTE - the host doesn't matter, any host can request this component.
	return bootstrap({ component: `macos_sdk_${version}` });
};

/** Apply one or more patches to a directory using the bootstrap utils. */
export const patch = async (
	source: tg.Directory,
	...patches: Array<tg.File | tg.Symlink>
) => {
	const host = await std.triple.host();

	const patchScript = tg.Template.join(
		"\n",
		...patches.map((patch) => tg`patch -p1 < ${patch}`),
	);

	const script = tg`
		set -eu
		cp -R ${source} $OUTPUT
		chmod -R +w $OUTPUT
		cd $OUTPUT
		${patchScript}
	`;

	const shellArtifact = await shell(host);
	const shellExecutable = await shellArtifact
		.get("bin/dash")
		.then(tg.File.expect);
	const utilsArtifact = utils(host);

	const patchedSource = await tg
		.target({
			executable: shellExecutable,
			args: ["-c", script],
			env: {
				PATH: tg`${utilsArtifact}/bin:${shellArtifact}/bin`,
			},
			host,
		})
		.then((t) => t.output())
		.then(tg.Directory.expect);

	return patchedSource;
};

/** Download a component tarball from the remote host. */
export const remoteComponent = async (componentName: string) => {
	const version = "v2024.10.03";
	const url = `https://github.com/tangramdotdev/bootstrap/releases/download/${version}/${componentName}.tar.zst`;
	const checksum = checksums[componentName];
	tg.assert(checksum, `Could not locate checksum for ${componentName}.`);

	// Download and extract the selected tarball.
	return await std.download({ url, checksum }).then(tg.Directory.expect);
};

/** Enumerate the full set of components for a host. */
export const componentList = async (arg?: Arg) => {
	const host = arg?.host ?? (await std.triple.host());

	const linuxComponents = (hostTriple: string) => {
		const host = hostTriple.replace("-", "_");
		return [
			`dash_${host}`,
			`env_${host}`,
			`toolchain_${host}`,
			`utils_${host}`,
		];
	};
	const darwinComponents = [
		"dash_universal_darwin",
		"macos_sdk_12.1",
		"macos_sdk_12.3",
		"macos_sdk_14.5",
		"macos_sdk_15.1",
		"macos_sdk_15.2",
		"toolchain_universal_darwin",
		"utils_universal_darwin",
	];
	const expectedComponents: { [key: string]: Array<string> } = {
		["aarch64-darwin"]: darwinComponents,
		["aarch64-linux"]: linuxComponents("aarch64-linux"),
		["js"]: [],
		["universal_darwin"]: darwinComponents,
		["x86_64-darwin"]: darwinComponents,
		["x86_64-linux"]: linuxComponents("x86_64-linux"),
	};

	return expectedComponents[host];
};

export const test = tg.target(async () => {
	const host = await std.triple.host();
	// Assert that all expected components exist and provide a non-empty `bin/` subdirectory.
	const components = await componentList({ host });
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
						const entries = await artifact.entries();
						const binariesNotEmpty = Object.keys(entries).length > 0;
						return binariesNotEmpty;
					}),
				),
			)
		).every((result) => result),
	);
	return true;
});

const checksums: Record<string, tg.Checksum> = {
	"macos_sdk_12.1":
		"sha256:8416b3f8a10e6022fb196cbb4e85e772c9c56c6c67c9a068c7576224cbf184d0",
	"macos_sdk_12.3":
		"sha256:ceccfc1181049d92e8d8a007180bca3c3cdc66d3e818c0e6c866f5312d5ed7b4",
	"macos_sdk_14.5":
		"sha256:527106e3ca78ce0aa69469ffac3ebb9c75dffa95d38749e962311819864d05a7",
	"macos_sdk_15.1":
		"sha256:9cffeecbaa2a8111f23c12194f66cfc5bc40ac59c2afc459bb83b0080b5358f9",
	"macos_sdk_15.2":
		"sha256:3ac655aba6e6b36a0db65173b1f5e382e3614d7180e567a38f452b9715549f92",
	dash_aarch64_linux:
		"sha256:d1e6ed42b0596507ebfa9ce231e2f42cc67f823cc56c0897c126406004636ce7",
	dash_universal_darwin:
		"sha256:026f919826c372cab0f2ac09b647fd570153efdb3e0ea5d8c9f05e1bca02f028",
	dash_x86_64_linux:
		"sha256:d23258e559012dc66cc82d9def66b51e9c41f9fb88f8e9e6a5bd19d231028a64",
	env_aarch64_linux:
		"sha256:b2985354036c4deea9b107f099d853ac2d7c91a095dc285922f6dab72ae1474c",
	env_x86_64_linux:
		"sha256:fceb5be5a7d6f59a026817ebb17be2bcc294d753f1528cbc921eb9015b9ff87b",
	toolchain_aarch64_linux:
		"sha256:01cf6871a4e8c28fe29572bc807edfacd8d5e44d0ee5455de8acbb53f516ec98",
	toolchain_universal_darwin:
		"sha256:49de2d7ba2e008d089c8b2ab8e544a429b861f3d45037bba0f0d27b6ec56386d",
	toolchain_x86_64_linux:
		"sha256:a3f9ec87394e63f90ec8784e6980727821fe0753b783e86ce298f54145372fad",
	utils_aarch64_linux:
		"sha256:486ef386ca587e5a3366df556da6140e9fd633462580a53c63942af411c9f40f",
	utils_universal_darwin:
		"sha256:7bd26e53a370d66eb05436c0a128d183a66dd2aba3c2524d94b916bd4515be40",
	utils_x86_64_linux:
		"sha256:dcbc2b66a046a66216f4c54d79f2a434c086346799f28b7f405bd6a2dc0e8543",
};
