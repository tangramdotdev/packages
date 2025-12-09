import * as std from "std" with { local: "./std" };
import { $ } from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://nodejs.org/en",
	license:
		"https://github.com/nodejs/node/blob/12fb157f79da8c094a54bc99370994941c28c235/LICENSE",
	name: "nodejs",
	repository: "https://github.com/nodejs/node",
	version: "22.18.0",
	tag: "nodejs/22.18.0",
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
	const target = std.triple.host();

	const releases: {
		[key: string]: {
			url: string;
			checksum: tg.Checksum;
		};
	} = {
		["aarch64-linux"]: {
			url: `https://nodejs.org/dist/v${version}/node-v${version}-linux-arm64.tar.xz`,
			checksum:
				"sha256:04fca1b9afecf375f26b41d65d52aa1703a621abea5a8948c7d1e351e85edade",
		},
		["x86_64-linux"]: {
			url: `https://nodejs.org/dist/v${version}/node-v${version}-linux-x64.tar.xz`,
			checksum:
				"sha256:c1bfeecf1d7404fa74728f9db72e697decbd8119ccc6f5a294d795756dfcfca7",
		},
		["aarch64-darwin"]: {
			url: `https://nodejs.org/dist/v${version}/node-v${version}-darwin-arm64.tar.xz`,
			checksum:
				"sha256:6616f388e127c858989fc7fa92879cdb20d2a5d446adbfdca6ee4feb385bfa8a",
		},
		["x86_64-darwin"]: {
			url: `https://nodejs.org/dist/v${version}/node-v${version}-darwin-x64.tar.xz`,
			checksum:
				"sha256:76e4a1997da953dbf8e21f6ed1c4dd7eceb39deb96defe3b3e9d8f786ee287a8",
		},
	};

	// Get the NodeJS release.
	tg.assert(target in releases, `Unsupported target system: ${target}.`);

	const release = releases[target];
	tg.assert(release, "Unsupported target");
	const { url, checksum } = release;

	// Download and return the inner object.
	const download = await std.download.extractArchive({ url, checksum });

	tg.assert(download instanceof tg.Directory);
	const node = await std.directory.unwrap(download);
	tg.assert(node instanceof tg.Directory);
	return node;
};

export const self = async (args?: tg.Unresolved<ToolchainArg>) => {
	const resolved = await tg.resolve(args);
	// Download Node
	const artifact = source();

	// Bundle Node with OpenSSL and ca_certificates.
	const opensslCnf = resolved?.opensslCnf ?? tg.file``;

	const unwrapped = artifact
		.then((d) => d.get("bin/node"))
		.then(tg.File.expect);
	const wrapped = std.wrap(unwrapped, {
		env: {
			SSL_CERT_FILE: tg`${std.caCertificates()}/cacert.pem`,
			OPENSSL_CONF: opensslCnf,
		},
	});

	return tg.directory(artifact, {
		["bin/node"]: wrapped,
	});
};

export const test = async () => {
	const node = self();
	return await $`
		set -x
		mkdir -p ${tg.output}
		echo "node: " ${node}
		node --version
		echo "Checking if we can run node scripts."
		node -e 'console.log("Hello, world!!!")'
	`.env(node);
};

type PackageJson = {
	bin?: Record<string, string>;
	scripts?: {
		build?: string;
	};
};

export default self;

export type Arg = {
	build?: string;
	checksum?: tg.Checksum;
	env?: std.env.Arg;
	host?: string;
	packageLock?: tg.File;
	source: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		build,
		env: env_,
		host,
		packageLock: packageLockArg,
		source,
	} = await std.packages.applyArgs<Arg>(...args);
	tg.assert(source, "Must provide a source");

	const node = await tg.build(self, std.triple.rotate({ build, host }));
	const interpreter = await node.get("bin/node").then(tg.File.expect);

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
	let devBins = tg.directory();
	for (const [dst, pkg] of Object.entries(packageLock.packages)) {
		if (pkg.bin && pkg.dev) {
			for (const [name, path] of Object.entries(pkg.bin)) {
				const executable = devDependencies
					.get(`${dst}/${path}`)
					.then(tg.File.expect);
				const wrapped = std.wrap({
					executable,
					interpreter,
					env: {
						NODE_PATH: tg`${devDependencies}/node_modules`,
					},
				});
				devBins = tg.directory(devBins, {
					[`bin/${name}`]: wrapped,
				});
			}
		}
	}

	let defaultBuildCommand = "";
	if (packageJson.scripts?.build) {
		defaultBuildCommand = packageJson.scripts?.build;
	}
	const sdk = await tg.build(std.sdk, { host });
	const env = await std.env.arg(
		sdk,
		node,
		devBins,
		{ NODE_PATH: tg`${devDependencies}/node_modules` },
		env_,
	);

	const built = await $`
		mkdir -p ${tg.output}
		cd ${tg.output}
		cp -R "${source}/." .
		ln -s "$NODE_PATH" node_modules
		${defaultBuildCommand}
		unlink node_modules
	`
		.env(env)
		.then(tg.Directory.expect);

	// If the package contained any bin entries we return a bin directory with them wrapped.
	if (packageJson.bin) {
		const bin = wrapBin(node, built, packageJson.bin, dependencies);
		return tg.directory(bin, {
			build: built,
		});
	}
	// Otherwise, return the result of building the package.
	else {
		return built;
	}
};

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

export const install = async (
	packageLockJson: tg.File,
): Promise<[tg.Directory, tg.Directory]> => {
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
};

/** Wrap any scripts pointed to by the "bin" field in the package.json. */
export const wrapBin = async (
	nodeArg: tg.Unresolved<tg.Directory>,
	argArg: tg.Unresolved<tg.Directory>,
	binsArg: tg.Unresolved<Record<string, string>>,
	dependenciesArg: tg.Unresolved<tg.Directory>,
) => {
	const node = await tg.resolve(nodeArg);
	const arg = await tg.resolve(argArg);
	const bins = await tg.resolve(binsArg);
	const dependencies = await tg.resolve(dependenciesArg);
	// Grab the interpreter.
	const interpreter = await node.get("bin/node").then(tg.File.expect);

	// Iterate the list of binaries in the `bin` field of the package.json and wrap.
	let bin = tg.directory();
	for (const [name, path] of Object.entries(bins)) {
		const executable = tg.symlink(tg`${arg}/${path}`);
		const wrapped = std.wrap({
			executable,
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
};

/** Given a package-lock.json, return a list of the paths to install and tarballs to use. */
const downloadPackages = async (
	packageLock: PackageLockJson,
): Promise<Array<[string, tg.Directory, boolean]>> => {
	const dls = Object.entries(packageLock.packages).filter(([name, data]) => {
		return name.length !== 0 && data.resolved && data.integrity;
	});

	const all = dls.map(async ([name, data]) => {
		const checksums = (data.integrity as string).split(" ");
		const integrity = checksums.find((i) => tg.Checksum.is(i));
		if (!integrity) {
			throw new Error(
				`Cannot download ${data.resolved}. Missing integrity hash.`,
			);
		}

		const dir = await std
			.download({
				url: data.resolved as string,
				checksum: integrity,
				mode: "extract",
			})
			.then(tg.Directory.expect)
			.then(std.directory.unwrap);
		return [name, dir, data.dev] as [string, tg.Directory, boolean];
	});

	return Promise.all(all);
};

/** Install a list of packages to the paths specified by package-lock.json. */
const installPackages = async (
	packages: Array<[string, tg.Directory, boolean]>,
	installDev: boolean,
): Promise<tg.Directory> => {
	const directories = await Promise.all(
		packages.map(async ([path, dir, isDev]) => {
			// Skip dev dependencies if installDev is false.
			if (isDev && !installDev) {
				return undefined;
			}
			return [path, dir];
		}),
	);

	// Attempt to install the unpacked artifact to the directory pointed to by `path`. We make a best-effort to point to installed artifacts and avoid deep copies.
	let nodeModules = await tg.directory();
	for (const installed of directories) {
		if (installed) {
			const [path, directory] = installed;
			nodeModules = await tg.directory(nodeModules, { [`${path}`]: directory });
		}
	}

	return nodeModules;
};
