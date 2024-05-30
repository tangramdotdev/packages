import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://nodejs.org/en",
	license:
		"https://github.com/nodejs/node/blob/12fb157f79da8c094a54bc99370994941c28c235/LICENSE",
	name: "nodejs",
	repository: "https://github.com/nodejs/node",
	version: "20.13.1",
};

type ToolchainArg = {
	/** An optional openssl.cnf file. Empty by default. */
	opensslCnf?: tg.File | tg.Symlink;
	host?: string;
	target?: string;
};

// URLs taken from https://nodejs.org/dist/v${version}/.
// Hashes taken from https://nodejs.org/dist/v${version}/SHASUM256.txt.asc
let source = async (): Promise<tg.Directory> => {
	// Known versions of NodeJS.
	let version = metadata.version;
	let target = await std.triple.host();

	let releases: {
		[key: string]: {
			url: string;
			checksum: tg.Checksum;
		};
	} = {
		["aarch64-linux"]: {
			url: `https://nodejs.org/dist/v${version}/node-v${version}-linux-arm64.tar.xz`,
			checksum:
				"sha256:d251cda3ee0a539d8aea4ea2327e98998cb23487569073902e35efb0526d574b",
		},
		["x86_64-linux"]: {
			url: `https://nodejs.org/dist/v${version}/node-v${version}-linux-x64.tar.xz`,
			checksum:
				"sha256:efc0f295dd878e510ab12ea36bbadc3db03c687ab30c07e86c7cdba7eed879a9",
		},
		["aarch64-darwin"]: {
			url: `https://nodejs.org/dist/v${version}/node-v${version}-darwin-arm64.tar.xz`,
			checksum:
				"sha256:e8a8e78b91485bc95d20f2aa86201485593685c828ee609245ce21c5680d07ce",
		},
		["x86_64-darwin"]: {
			url: `https://nodejs.org/dist/v${version}/node-v${version}-darwin-x64.tar.xz`,
			checksum:
				"sha256:c83bffeb4eb793da6cb61a44c422b399048a73d7a9c5eb735d9c7f5b0e8659b6",
		},
	};

	// Get the NodeJS release.
	tg.assert(target in releases, `Unsupported target system: ${target}.`);

	let release = releases[target];
	tg.assert(release, "Unsupported target");
	let { url, checksum } = release;

	// Download and return the inner object.
	let download = await std.download({ url, checksum });

	tg.assert(download instanceof tg.Directory);
	let node = await std.directory.unwrap(download);
	tg.assert(node instanceof tg.Directory);
	return node;
};

export let nodejs = tg.target(async (args?: ToolchainArg) => {
	// Download Node
	let artifact = source();

	// Bundle Node with OpenSSL and ca_certificates.
	let opensslCnf = args?.opensslCnf ?? tg.file(``);

	let wrappedNode = std.wrap(tg.symlink(tg`${artifact}/bin/node`), {
		env: {
			SSL_CERT_FILE: tg`${std.caCertificates()}/cacert.pem`,
			OPENSSL_CONF: opensslCnf,
		},
	});

	return tg.directory(artifact, {
		["bin/node"]: wrappedNode,
	});
});

export let test = tg.target(async () => {
	let node = nodejs();
	return std.build(
		tg`
		set -x
		mkdir -p $OUTPUT
		echo "node: " ${node}
		node --version
		echo "Checking if we can run node scripts."
		node -e 'console.log("Hello, world!!!")'
	`,
		{ env: node },
	);
});

type PackageJson = {
	bin?: Record<string, string>;
	scripts?: {
		build?: string;
	};
};

export default nodejs;

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

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let mutationArgs = await std.args.createMutations<
		Arg,
		std.args.MakeArrayKeys<Arg, "env" | "phases" | "sdk">
	>(std.flatten(args), {
		phases: "append",
		sdk: "append",
		source: "set",
	});
	let {
		build: buildArg,
		env: env_,
		host: hostArg,
		packageLock: packageLockArg,
		phases: phasesArg,
		sdk: sdkArg,
		source,
	} = await std.args.applyMutations(mutationArgs);
	tg.assert(source, "Must provide a source");

	let host = hostArg ?? (await std.triple.host());
	let build = buildArg ?? host;

	let node = nodejs({
		host: build,
		target: host,
	});

	// Retrieve and parse the package.json, package-lock.json files.
	let packageJsonFile = tg.File.expect(await source.get("package.json"));
	let packageJson = tg.encoding.json.decode(
		await packageJsonFile.text(),
	) as PackageJson;

	let packageLockFile =
		packageLockArg ?? tg.File.expect(await source.get("package-lock.json"));
	let packageLock = tg.encoding.json.decode(
		await packageLockFile.text(),
	) as PackageLockJson;

	// Install the dependencies and dev dependencies.
	let [dependencies, devDependencies] = await install(packageLockFile);

	// Wrap any things in the dev dependencies' bin fields.
	let devBins = tg.directory();
	for (let [dst, pkg] of Object.entries(packageLock.packages)) {
		if (pkg.bin && pkg.dev) {
			for (let [name, path] of Object.entries(pkg.bin)) {
				// Get the executable as a symlink, since it may refer to other things in adjacent directories.
				let executable = tg.symlink(tg`${devDependencies}/${dst}/${path}`);

				// Wrap the executable using node as the interpreter.
				let wrapped = std.wrap({
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

	let prepare = await tg`
		set -e
		mkdir -p $OUTPUT
		cd $OUTPUT

		# Copy the source to the output.
		cp -R "${source}/." .

		# Some tools (eg tsc: https://github.com/Microsoft/TypeScript/issues/8760) do not respect NODE_PATH, so we need to make sure there is a local node_modules directory in the working directory.
		ln -s "${devDependencies}/node_modules" node_modules`;

	let fixup = await tg`
		# Purge the devDependencies node_modules and replace with the runtime dependencies node_moduels
		rm -rf node_modules
		ln -s "${dependencies}/node_modules" node_modules
	`;

	let phases: std.phases.PhasesArg = {
		prepare,
		build: defaultBuildCommand,
		fixup,
	};

	let sdk = std.sdk({ host }, sdkArg ?? []);
	let env = std.env.arg(
		sdk,
		node,
		devBins,
		{ NODE_PATH: tg`${devDependencies}/node_modules` },
		env_,
	);

	let additionalPhasesArgs = (phasesArg ?? []).filter(
		(arg) => arg !== undefined,
	) as Array<std.phases.Arg>;

	let built = await std.phases.build(
		{
			phases,
			env,
		},
		...additionalPhasesArgs,
	);

	tg.Directory.assert(built);
	// If the package contained any bin entries we return a bin directory with them wrapped.
	if (packageJson.bin) {
		let bin = wrapBin(node, built, packageJson.bin, dependencies);
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

export let install = tg.target(
	async (packageLockJson: tg.File): Promise<[tg.Directory, tg.Directory]> => {
		// Parse the package-lock.json.
		let packageLock = tg.encoding.json.decode(
			await packageLockJson.text(),
		) as PackageLockJson;

		// Install the packages specified by the package-lock.json.
		let downloads = await downloadPackages(packageLock);

		return [
			await installPackages(downloads, false),
			await installPackages(downloads, true),
		];
	},
);

/** Wrap any scripts pointed to by the "bin" field in the package.json. */
export let wrapBin = tg.target(
	async (
		node: tg.Directory,
		arg: tg.Directory,
		bins: Record<string, string>,
		dependencies: tg.Directory,
	) => {
		// Grap the interpreter.
		let interpreter = await tg.symlink(tg`${node}/bin/node`);

		// Iterate the list of binaries in the `bin` field of the package.json and wrap.
		let bin = tg.directory();
		for (let [name, path] of Object.entries(bins)) {
			let wrapped = std.wrap({
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
let downloadPackages = async (
	packageLock: PackageLockJson,
): Promise<Array<[string, tg.File, boolean]>> => {
	let dls = Object.entries(packageLock.packages).filter(([name, data]) => {
		return name.length !== 0 && data.resolved && data.integrity;
	});

	let all = dls.map(async ([name, data]) => {
		let checksums = (data.integrity as string).split(" ");
		let integrity = checksums.find((i) => i.startsWith("sha512"));
		if (!integrity) {
			throw new Error(
				`Cannot download ${data.resolved}. Missing sha512 integrity hash.`,
			);
		}

		let file = await std.download({
			url: data.resolved as string,
			checksum: integrity,
		});
		return [name, tg.File.expect(file), data.dev] as [string, tg.File, boolean];
	});

	return Promise.all(all);
};

/** Install a list of packages to the paths specified by package-lock.json. */
let installPackages = async (
	packages: Array<[string, tg.File, boolean]>,
	installDev: boolean,
): Promise<tg.Directory> => {
	// Unpack each package in parallel.
	let directories = await Promise.all(
		packages.map(async ([path, tarball, isDev]) => {
			// Skip dev dependencies if installDev is false.
			if (isDev && !installDev) {
				return undefined;
			}

			let installed = await std.build(
				tg`
				echo "Installing ${path}"
				mkdir -p $OUTPUT
				tar -xf ${tarball} --strip-components=1 --warning=no-unknown-keyword -C $OUTPUT
			`,
				{ env: std.sdk() },
			);

			return [path, installed] as [string, tg.Directory];
		}),
	);

	// Attempt to install the unpacked artifact to the directory pointed to by `path`. We make a best-effort to point to installed artifacts and avoid deep copies.
	let nodeModules = await tg.directory();
	for (let installed of directories) {
		if (installed) {
			let [path, directory] = installed;
			nodeModules = await tg.directory(nodeModules, { [path]: directory });
		}
	}

	return nodeModules;
};
