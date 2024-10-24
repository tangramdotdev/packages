import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://nodejs.org/en",
	license:
		"https://github.com/nodejs/node/blob/12fb157f79da8c094a54bc99370994941c28c235/LICENSE",
	name: "nodejs",
	repository: "https://github.com/nodejs/node",
	version: "20.18.0",
};

export type ToolchainArg = {
	/** An optional openssl.cnf file. Empty by default. */
	opensslCnf?: tg.File | tg.Symlink;
	host?: string;
	target?: string;
};

// URLs taken from `https://nodejs.org/dist/v${version}/`.
// Hashes taken from `https://nodejs.org/dist/v${version}/SHASUMS256.txt.asc`.
const source = async (): Promise<tg.Directory> => {
	// Known versions of NodeJS.
	const version = metadata.version;
	const target = await std.triple.host();

	const releases: {
		[key: string]: {
			url: string;
			checksum: tg.Checksum;
		};
	} = {
		["aarch64-linux"]: {
			url: `https://nodejs.org/dist/v${version}/node-v${version}-linux-arm64.tar.xz`,
			checksum:
				"sha256:a9ce85675ba33f00527f6234d90000946c0936fb4fca605f1891bb5f4fe6fb0a",
		},
		["x86_64-linux"]: {
			url: `https://nodejs.org/dist/v${version}/node-v${version}-linux-x64.tar.xz`,
			checksum:
				"sha256:4543670b589593f8fa5f106111fd5139081da42bb165a9239f05195e405f240a",
		},
		["aarch64-darwin"]: {
			url: `https://nodejs.org/dist/v${version}/node-v${version}-darwin-arm64.tar.xz`,
			checksum:
				"sha256:678e062bdae3824aa997bd469580a4dda48fd51f61d3679b6ba06352e6cef38f",
		},
		["x86_64-darwin"]: {
			url: `https://nodejs.org/dist/v${version}/node-v${version}-darwin-x64.tar.xz`,
			checksum:
				"sha256:63e150a3bb4f31743257d8597262c6b5f0a2356e7c42002e29d5f7d1bf161f08",
		},
	};

	// Get the NodeJS release.
	tg.assert(target in releases, `Unsupported target system: ${target}.`);

	const release = releases[target];
	tg.assert(release, "Unsupported target");
	const { url, checksum } = release;

	// Download and return the inner object.
	const download = await std.download({ url, checksum });

	tg.assert(download instanceof tg.Directory);
	const node = await std.directory.unwrap(download);
	tg.assert(node instanceof tg.Directory);
	return node;
};

export const toolchain = tg.target(async (args?: ToolchainArg) => {
	// Download Node
	const artifact = source();

	// Bundle Node with OpenSSL and ca_certificates.
	const opensslCnf = args?.opensslCnf ?? tg.file(``);

	const wrappedNode = std.wrap(tg.symlink(tg`${artifact}/bin/node`), {
		env: {
			SSL_CERT_FILE: tg`${std.caCertificates()}/cacert.pem`,
			OPENSSL_CONF: opensslCnf,
		},
	});

	return tg.directory(artifact, {
		["bin/node"]: wrappedNode,
	});
});

export const test = tg.target(async () => {
	const node = toolchain();
	return await $`
		set -x
		mkdir -p $OUTPUT
		echo "node: " ${node}
		node --version
		echo "Checking if we can run node scripts."
		node -e 'console.log("Hello, world!!!")'
	`.env(node);
});

type PackageJson = {
	bin?: Record<string, string>;
	scripts?: {
		build?: string;
	};
};

export default toolchain;

export type Arg = {
	build?: string;
	checksum?: tg.Checksum;
	env?: std.env.Arg;
	host?: string;
	packageLock?: tg.File;
	phases?: std.phases.Arg;
	sdk?: std.sdk.Arg;
	source: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const mutationArgs = await std.args.createMutations<
		Arg,
		std.args.MakeArrayKeys<Arg, "env" | "phases" | "sdk">
	>(std.flatten(args), {
		phases: "append",
		sdk: "append",
		source: "set",
	});
	const {
		build: buildArg,
		env: env_,
		host: hostArg,
		packageLock: packageLockArg,
		phases: phasesArg,
		sdk: sdkArg,
		source,
	} = await std.args.applyMutations(mutationArgs);
	tg.assert(source, "Must provide a source");

	const host = hostArg ?? (await std.triple.host());
	const build = buildArg ?? host;

	const node = toolchain({
		host: build,
		target: host,
	});

	// Retrieve and parse the package.json, package-lock.json files.
	const packageJsonFile = tg.File.expect(await source.get("package.json"));
	const packageJson = tg.encoding.json.decode(
		await packageJsonFile.text(),
	) as PackageJson;

	const packageLockFile =
		packageLockArg ?? tg.File.expect(await source.get("package-lock.json"));
	const packageLock = tg.encoding.json.decode(
		await packageLockFile.text(),
	) as PackageLockJson;

	// Install the dependencies and dev dependencies.
	const [dependencies, devDependencies] = await install(packageLockFile);

	// Wrap any things in the dev dependencies' bin fields.
	let devBins = tg.directory();
	for (const [dst, pkg] of Object.entries(packageLock.packages)) {
		if (pkg.bin && pkg.dev) {
			for (const [name, path] of Object.entries(pkg.bin)) {
				// Get the executable as a symlink, since it may refer to other things in adjacent directories.
				const executable = tg.symlink(tg`${devDependencies}/${dst}/${path}`);

				// Wrap the executable using node as the interpreter.
				const wrapped = std.wrap({
					interpreter: tg.symlink(tg`${node}/bin/node`),
					executable: executable,
					env: {
						NODE_PATH: tg`${devDependencies}/node_modules`,
					},
				});

				// Add the wrapped bin to the devBins directory.
				devBins = tg.directory(devBins, {
					[`bin/${name}`]: wrapped,
				});
			}
		}
	}

	// Get the default build command.
	let defaultBuildCommand = "";
	if (packageJson.scripts?.build) {
		defaultBuildCommand = packageJson.scripts?.build;
	}

	const prepare = await tg`
		set -e
		mkdir -p $OUTPUT
		cd $OUTPUT

		# Copy the source to the output.
		cp -R "${source}/." .

		# Some tools (eg tsc: https://github.com/Microsoft/TypeScript/issues/8760) do not respect NODE_PATH, so we need to make sure there is a local node_modules directory in the working directory.
		ln -s "${devDependencies}/node_modules" node_modules`;

	const fixup = await tg`
		# Purge the devDependencies node_modules and replace with the runtime dependencies node_moduels
		rm -rf node_modules
		ln -s "${dependencies}/node_modules" node_modules
	`;

	const phases: std.phases.PhasesArg = {
		prepare,
		build: defaultBuildCommand,
		fixup,
	};

	const sdk = std.sdk({ host }, sdkArg ?? []);
	const env = std.env.arg(
		sdk,
		node,
		devBins,
		{ NODE_PATH: tg`${devDependencies}/node_modules` },
		env_,
	);

	const additionalPhasesArgs = (phasesArg ?? []).filter(
		(arg) => arg !== undefined,
	) as Array<std.phases.Arg>;

	const built = await std.phases.build(
		{
			phases,
			env,
		},
		...additionalPhasesArgs,
	);

	tg.Directory.assert(built);
	// If the package contained any bin entries we return a bin directory with them wrapped.
	if (packageJson.bin) {
		const bin = wrapBin(node, built, packageJson.bin, dependencies);
		return tg.directory(bin, {
			build: tg.symlink(built),
		});
	}
	// Otherwise, return the result of building the package.
	else {
		return built;
	}
});

type PackageLockJson = {
	packages: Record<
		string,
		{
			bin?: Record<string, string>;
			dev?: boolean;
			resolved?: string;
			integrity?: tg.Checksum;
		}
	>;
};

export const install = tg.target(
	async (packageLockJson: tg.File): Promise<[tg.Directory, tg.Directory]> => {
		// Parse the package-lock.json.
		const packageLock = tg.encoding.json.decode(
			await packageLockJson.text(),
		) as PackageLockJson;

		// Install the packages specified by the package-lock.json.
		const downloads = await downloadPackages(packageLock);

		return [
			await installPackages(downloads, false),
			await installPackages(downloads, true),
		];
	},
);

/** Wrap any scripts pointed to by the "bin" field in the package.json. */
export const wrapBin = tg.target(
	async (
		node: tg.Directory,
		arg: tg.Directory,
		bins: Record<string, string>,
		dependencies: tg.Directory,
	) => {
		// Grap the interpreter.
		const interpreter = await tg.symlink(tg`${node}/bin/node`);

		// Iterate the list of binaries in the `bin` field of the package.json and wrap.
		let bin = tg.directory();
		for (const [name, path] of Object.entries(bins)) {
			const wrapped = std.wrap({
				// The executable probably references other files in the same directory, so we wrap it through a symlink.
				executable: tg.symlink(tg`${arg}/${path}`),
				interpreter,
				env: {
					NODE_PATH: tg.Mutation.suffix(tg`${dependencies}/node_modules`, ":"),
				},
			});

			bin = tg.directory(bin, {
				[name]: wrapped,
			});
		}

		return tg.directory({ bin });
	},
);

/** Given a package-lock.json, return a list of the paths to install and tarballs to use. */
const downloadPackages = async (
	packageLock: PackageLockJson,
): Promise<Array<[string, tg.File, boolean]>> => {
	const dls = Object.entries(packageLock.packages).filter(([name, data]) => {
		return name.length !== 0 && data.resolved && data.integrity;
	});

	const all = dls.map(async ([name, data]) => {
		const checksums = (data.integrity as string).split(" ");
		const integrity = checksums.find((i) => i.startsWith("sha512"));
		if (!integrity) {
			throw new Error(
				`Cannot download ${data.resolved}. Missing sha512 integrity hash.`,
			);
		}

		const file = await std.download({
			url: data.resolved as string,
			checksum: integrity,
		});
		return [name, tg.File.expect(file), data.dev] as [string, tg.File, boolean];
	});

	return Promise.all(all);
};

/** Install a list of packages to the paths specified by package-lock.json. */
const installPackages = async (
	packages: Array<[string, tg.File, boolean]>,
	installDev: boolean,
): Promise<tg.Directory> => {
	// Unpack each package in parallel.
	const directories = await Promise.all(
		packages.map(async ([path, tarball, isDev]) => {
			// Skip dev dependencies if installDev is false.
			if (isDev && !installDev) {
				return undefined;
			}

			const installed = await $`
				echo "Installing ${path}"
				mkdir -p $OUTPUT
				tar -xf ${tarball} --strip-components=1 --warning=no-unknown-keyword -C $OUTPUT
			`
				.env(std.sdk())
				.then(tg.Directory.expect);

			return [path, installed] as [string, tg.Directory];
		}),
	);

	// Attempt to install the unpacked artifact to the directory pointed to by `path`. We make a best-effort to point to installed artifacts and avoid deep copies.
	let nodeModules = await tg.directory();
	for (const installed of directories) {
		if (installed) {
			const [path, directory] = installed;
			nodeModules = await tg.directory(nodeModules, { [path]: directory });
		}
	}

	return nodeModules;
};
