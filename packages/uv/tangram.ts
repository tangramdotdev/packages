import * as python from "python" with { source: "../python" };
import * as std from "std" with { source: "../std" };
import { $ } from "std" with { source: "../std" };

import * as lockfile from "./lockfile.tg.ts";
import tests from "./tests" with { type: "directory" };

export { lockfile };

export const metadata = {
	builds: { exports: ["default", "self"] },
	homepage: "https://docs.astral.sh/uv",
	license: "Apache-2.0 OR MIT",
	name: "uv",
	repository: "https://github.com/astral-sh/uv",
	version: "0.13.9",
	tag: "uv/0.13.9",
	provides: {
		binaries: ["uv", "uvx"],
	},
};

export type ToolchainArg = {
	/** The machine the uv executables run on. */
	host?: string;
};

/** Download the prebuilt uv executables. */
export async function self(...args: tg.Args<ToolchainArg>) {
	const { host: host_ } = await std.packages.applyArgs<ToolchainArg>(...args);
	const host = host_ ?? std.triple.host();
	const release = releases[std.triple.archAndOs(host)];
	tg.assert(release, `unsupported host ${host}`);
	const { checksum, triple } = release;
	const url = `https://github.com/astral-sh/uv/releases/download/${metadata.version}/uv-${triple}.tar.gz`;
	const download = await std.download
		.extractArchive({ checksum, url })
		.then(tg.Directory.expect);
	const executable = (name: string) =>
		download
			.get(`uv-${triple}/${name}`)
			.then(tg.File.expect)
			.then((file) => tg.file(file, { executable: true }));
	const output = await tg.directory({
		"bin/uv": executable("uv"),
		"bin/uvx": executable("uvx"),
	});
	return output;
}

export default self;

// The checksums are taken from https://github.com/astral-sh/uv/releases/download/${version}/sha256.sum.
const releases: { [key: string]: { checksum: tg.Checksum; triple: string } } = {
	["aarch64-darwin"]: {
		checksum:
			"sha256:5aeca67f2283f75235de40d0bd9c0a5bbc5fce23b6d48b3bf9fa1b2db08382ca",
		triple: "aarch64-apple-darwin",
	},
	["aarch64-linux"]: {
		checksum:
			"sha256:37fbb7c5bc66cf99c12aa881949d216181e201dec449772c4329e56487d61179",
		triple: "aarch64-unknown-linux-musl",
	},
	["x86_64-darwin"]: {
		checksum:
			"sha256:617a3211261b0fc739562f0071aa34e9739797c510208ede8e2977c30903d041",
		triple: "x86_64-apple-darwin",
	},
	["x86_64-linux"]: {
		checksum:
			"sha256:58ccf5f1792b8a5a88d01bc910ea131a8b3db4a319a17ad5fad75e0845a3e271",
		triple: "x86_64-unknown-linux-musl",
	},
};

export type Arg = {
	/** Whether to install the default dependency groups, such as `dev`. Default: false. */
	defaultGroups?: boolean;

	/** Dependencies configuration. When provided, deps are resolved to env automatically. */
	deps?: std.deps.ConfigArg;

	/** Environment variables to set while installing. */
	env?: std.env.Arg;

	/** The extras to install. */
	extras?: Array<string>;

	/** The dependency groups to install in addition to the project dependencies. */
	groups?: Array<string>;

	/** The machine that installs the project and runs the output. */
	host?: string;

	/** The lockfile. Defaults to the `uv.lock` in the source directory. */
	lockfile?: tg.File;

	/** The workspace members to install. When empty, the workspace root is installed. */
	packages?: Array<string>;

	/** A name for the process that builds the project. */
	processName?: string;

	/** Arguments for the Python toolchain. */
	python?: python.Arg;

	/** The Python version. Defaults to the version in `.python-version`, then a version that satisfies `requires-python`. */
	pythonVersion?: PythonVersion;

	/** SDK configuration to use when building source distributions. */
	sdk?: std.sdk.Arg;

	/** The source directory, which contains a `pyproject.toml`. */
	source?: tg.Directory;

	/** Environment to propagate to all dependencies in the subtree. */
	subtreeEnv?: std.env.Arg;

	/** SDK configuration to propagate to all dependencies in the subtree. */
	subtreeSdk?: std.sdk.Arg;
};

/** The result of arg() - an Arg with host and source guaranteed to be resolved. */
export type ResolvedArg = Omit<Arg, "deps" | "host" | "source"> & {
	host: string;
	source: tg.Directory;
};

export type PythonVersion = keyof typeof python.versions;

/** Resolve uv args. Returns an Arg with host and source guaranteed to be resolved. */
export async function arg(...args: tg.Args<Arg>): Promise<ResolvedArg> {
	const collect = await tg.Args.apply<
		Arg,
		tg.ValueOrMaybeMutationMap<Arg>,
		Arg
	>({
		args,
		map: async (arg) => arg,
		reduce: {
			env: (a, b) => std.env.arg(a ?? null, b ?? null),
			extras: "append",
			groups: "append",
			packages: "append",
			sdk: (a, b) => std.sdk.mergeArg(a, b),
			subtreeEnv: (a, b) => std.env.arg(a ?? null, b ?? null),
			subtreeSdk: (a, b) => std.sdk.mergeArg(a, b),
		},
	});
	const { deps, env: userEnv, host: host_, source, ...rest } = collect;
	tg.assert(source !== undefined, "source must be defined");
	const host = host_ ?? std.triple.host();

	// Build the dependencies and create the env.
	const depsConfig = await std.deps.resolveConfig(deps);
	const depsEnv = depsConfig
		? await std.deps.env(depsConfig, {
				build: host,
				host,
				...std.args.optional("env", userEnv),
				...std.args.optional("sdk", rest.sdk),
				...std.args.optional("subtreeEnv", rest.subtreeEnv),
				...std.args.optional("subtreeSdk", rest.subtreeSdk),
			})
		: undefined;
	const env = await std.env.arg(depsEnv ?? null, userEnv ?? null);

	return { env, host, source, ...rest };
}

/** Install a uv project and its locked dependencies. Every distribution is downloaded with the checksum recorded in `uv.lock`, and uv runs without network access. */
export async function build(...args: tg.Args<Arg>): Promise<tg.Directory> {
	const {
		defaultGroups = false,
		env: env_,
		extras = [],
		groups = [],
		host,
		lockfile: lockfile_,
		packages = [],
		processName,
		python: pythonArg,
		pythonVersion: pythonVersion_,
		sdk: sdkArg,
		source: source_,
	} = await arg(...args);

	// Place the lockfile in the source.
	const file = lockfile_ ?? (await source_.tryGet("uv.lock"));
	tg.assert(file instanceof tg.File, "could not locate uv.lock");
	const source = await tg.directory(source_, { "uv.lock": file });

	// Select the Python toolchain.
	const pythonVersion =
		pythonVersion_ ??
		(await selectPythonVersion(source, await lockfile.parse(file)));
	const pythonArtifact = await python.self(pythonArg ?? {}, {
		host,
		pythonVersion,
	});
	const interpreter = await tg.symlink(
		tg`${pythonArtifact}/bin/python${pythonVersion}`,
	);

	// Download the distributions pinned by the lockfile.
	const vendored = await tg
		.build(lockfile.vendor, file, host, pythonVersion)
		.then(tg.Directory.expect);

	// Create the env.
	const sdkArgObject = std.sdk.argObject(sdkArg);
	const sdk = std.sdk(
		{ host },
		...(sdkArgObject !== undefined ? [sdkArgObject] : []),
	);
	const env = await std.env.arg(
		sdk,
		self({ host }),
		pythonArtifact,
		{
			UV_COMPILE_BYTECODE: "0",
			UV_LINK_MODE: "copy",
			UV_NO_MANAGED_PYTHON: "1",
			UV_NO_PROGRESS: "1",
			UV_OFFLINE: "1",
		},
		env_ ?? null,
	);

	// Create the scripts.
	const selection = [
		...(defaultGroups ? [] : ["--no-default-groups"]),
		...extras.flatMap((extra) => ["--extra", extra]),
		...groups.flatMap((group) => ["--group", group]),
		...packages.flatMap((pkg) => ["--package", pkg]),
	].join(" ");
	const prepare = (tree: tg.Directory) => tg`
		set -eu
		export HOME="$PWD/home" TMPDIR="$PWD/tmp" UV_CACHE_DIR="$PWD/cache"
		mkdir -p "$HOME" "$TMPDIR" ${tg.output}
		cp -R ${tree}/. "$PWD/work"
		chmod -R u+w "$PWD/work"
		cd "$PWD/work"`;
	const exportRequirements = `uv export --frozen --format requirements.txt --no-header --no-annotate ${selection}`;
	const install = tg`uv pip install --python ${pythonArtifact}/bin/python${pythonVersion} --no-python-downloads --prefix ${tg.output} --no-index --find-links ${vendored} --no-deps`;

	// Remove the files that record the time and place of the installation, and replace each script's interpreter with a fixed path so that it can be wrapped.
	const normalize = tg`
		rm -f ${tg.output}/.lock
		find ${tg.output} -path '*.dist-info/*' \\( -name uv_cache.json -o -name direct_url.json \\) -delete
		find ${tg.output} -path '*.dist-info/RECORD' | while read -r record; do
			sed -e '/\\.dist-info\\/uv_cache\\.json,/d' -e '/\\.dist-info\\/direct_url\\.json,/d' -e 's|^\\(\\.\\./\\.\\./\\.\\./bin/[^,]*\\),.*$|\\1,,|' "$record" > "$TMPDIR/record"
			cat "$TMPDIR/record" > "$record"
		done
		if [ -d ${tg.output}/bin ]; then
			for script in ${tg.output}/bin/*; do
				if [ -f "$script" ] && sed -n '1,2p' "$script" | grep -q -e '^#!.*python' -e "^'''exec'"; then
					sed -e '1s|.*|#!/usr/bin/python3|' "$script" > "$TMPDIR/script"
					cat "$TMPDIR/script" > "$script"
				fi
			done
		fi`;

	// Install the locked dependencies from the manifests alone, so that the installation is reused when only the code changes.
	const manifests = await extractManifests(source);
	const dependencies = await std.build`
		${prepare(manifests)}
		${exportRequirements} --no-emit-local -o "$TMPDIR/requirements.txt"
		${install} --require-hashes -r "$TMPDIR/requirements.txt"
		${normalize}`
		.env(env)
		.host(std.triple.archAndOs(host))
		.then(tg.Directory.expect);

	// Build and install the project and any local packages it depends on.
	let builder = std.build`
		${prepare(source)}
		${exportRequirements} --only-emit-local --no-editable --no-hashes -o "$TMPDIR/requirements.txt"
		if grep -q '[^[:space:]]' "$TMPDIR/requirements.txt"; then
			if ! ${install} -r "$TMPDIR/requirements.txt"; then
				echo 'error: failed to build the project. If the build backend could not be found, add it to uv.lock, for example through a "build" dependency group.' >&2
				exit 1
			fi
		fi
		${normalize}`
		.env(env)
		.host(std.triple.archAndOs(host));
	if (processName !== undefined) {
		builder = builder.named(processName);
	}
	const project = await builder.then(tg.Directory.expect);

	// Combine the installations, and make the site-packages directory available at a path that does not depend on the Python version.
	let output = await tg.directory(dependencies, project);
	const sitePackages = `lib/python${pythonVersion}/site-packages`;
	if ((await output.tryGet(sitePackages)) !== undefined) {
		output = await tg.directory(output, {
			"lib/python3": tg.symlink(`python${pythonVersion}`),
		});
	}

	// Wrap the scripts.
	if ((await output.tryGet("bin")) !== undefined) {
		output = await python.wrapScripts(
			interpreter,
			await tg`${output}/${sitePackages}`,
			output,
			python.versions[pythonVersion].version,
		);
	}

	return output;
}

/** Extract the files that determine which dependencies uv installs. */
export async function extractManifests(
	source: tg.Directory,
): Promise<tg.Directory> {
	const names = [".python-version", "pyproject.toml", "uv.lock", "uv.toml"];
	const skipped = [".git", ".venv", "node_modules"];
	let output = await tg.directory();
	for await (const [name, artifact] of source) {
		if (artifact instanceof tg.Directory && !skipped.includes(name)) {
			const manifests = await extractManifests(artifact);
			if (Object.keys(await manifests.entries).length > 0) {
				output = await tg.directory(output, { [name]: manifests });
			}
		} else if (artifact instanceof tg.File && names.includes(name)) {
			output = await tg.directory(output, { [name]: artifact });
		}
	}
	return output;
}

/** Select the Python version for a project from its `.python-version` file, or else from the `requires-python` field of its lockfile. */
export async function selectPythonVersion(
	source: tg.Directory,
	lock: lockfile.Lockfile,
): Promise<PythonVersion> {
	// Use the pinned version if there is one.
	const pin = await source.tryGet(".python-version");
	if (pin instanceof tg.File) {
		const match = (await pin.text).match(/(\d+)\.(\d+)/);
		tg.assert(match, "could not parse .python-version");
		const version = `${match[1]}.${match[2]}`;
		tg.assert(
			version in python.versions,
			`the python version ${version} is not available`,
		);
		return version as PythonVersion;
	}

	// Otherwise, prefer the default version, then the newest version that the project supports.
	const versions = Object.keys(python.versions) as Array<PythonVersion>;
	const candidates = [python.defaultVersion, ...versions.reverse()];
	const specifiers = lock["requires-python"] ?? "";
	const version = candidates.find((candidate) =>
		satisfies(python.versions[candidate].version, specifiers),
	);
	tg.assert(
		version !== undefined,
		`no available python version satisfies ${specifiers}`,
	);
	return version;
}

/** Determine whether a version satisfies a comma-separated list of version specifiers. */
export function satisfies(version: string, specifiers: string): boolean {
	const parse = (value: string) => value.split(".").map(Number);
	const actual = parse(version);
	return specifiers
		.split(",")
		.map((specifier) => specifier.trim())
		.filter((specifier) => specifier.length > 0)
		.every((specifier) => {
			const match = specifier.match(
				/^(~=|==|!=|<=|>=|<|>)\s*([\d.]+?)(\.\*)?$/,
			);
			tg.assert(match, `unsupported version specifier ${specifier}`);
			const [, operator, value, wildcard] = match;
			const expected = parse(value as string);
			const prefix = (length: number) =>
				lockfile.compareVersions(
					actual.slice(0, length),
					expected.slice(0, length),
				) === 0;
			const comparison = lockfile.compareVersions(actual, expected);
			switch (operator) {
				case "~=":
					return comparison >= 0 && prefix(expected.length - 1);
				case "==":
					return wildcard ? prefix(expected.length) : comparison === 0;
				case "!=":
					return wildcard ? !prefix(expected.length) : comparison !== 0;
				case "<=":
					return comparison <= 0;
				case ">=":
					return comparison >= 0;
				case "<":
					return comparison < 0;
				default:
					return comparison > 0;
			}
		});
}

export async function test() {
	await Promise.all([
		lockfile.test(),
		testDependency(),
		testHatchling(),
		testHello(),
		testMissingBackend(),
		testPlatformWheel(),
		testSatisfies(),
		testToolchain(),
		testWorkspace(),
	]);
	return true;
}

export async function testToolchain() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(self, spec);
}

export function testSatisfies() {
	const cases: Array<[string, string, boolean]> = [
		["3.15.2", ">=3.13", true],
		["3.15.2", ">=3.13, <3.15", false],
		["3.14.8", ">=3.13, <3.15", true],
		["3.14.8", "==3.14.*", true],
		["3.15.2", "==3.14.*", false],
		["3.15.2", "!=3.15.*", false],
		["3.14.8", "~=3.13", true],
		["3.14.8", "~=3.14.9", false],
		["3.15.2", "", true],
	];
	for (const [version, specifiers, expected] of cases) {
		tg.assert(
			satisfies(version, specifiers) === expected,
			`expected ${version} ${expected ? "to satisfy" : "not to satisfy"} "${specifiers}"`,
		);
	}
	return true;
}

/** Run an installed script and return what it prints. */
async function run(output: tg.Directory, script: tg.Template.Arg) {
	const file = await $`${script} > ${tg.output}`
		.env(output)
		.then(tg.File.expect);
	return file.text;
}

export async function testHello() {
	const source = await tests.get("hello").then(tg.Directory.expect);
	const output = await build({ source });
	const text = await run(output, "hello");
	tg.assert(text.trim() === "Hello from uv!", `unexpected output: ${text}`);
	return output;
}

export async function testDependency() {
	const source = await tests.get("dependency").then(tg.Directory.expect);
	const output = await build({ source });

	// The script of the project must be able to import the dependency.
	const greeting = await run(output, "greeter");
	tg.assert(
		greeting.includes("Hello from uv!"),
		`unexpected output: ${greeting}`,
	);

	// The script of the dependency must be installed.
	const cow = await run(output, "cowsay -t moo");
	tg.assert(cow.includes("moo"), `unexpected output: ${cow}`);

	// The dependency that is only required on Windows must be skipped.
	const names = await sitePackagesNames(output);
	tg.assert(names.includes("cowsay"), `expected cowsay in ${names}`);
	tg.assert(
		!names.some((name) => name.startsWith("pywin32")),
		"expected pywin32 to be skipped",
	);
	return output;
}

/** Return the names of the entries in the site-packages directory of an output. */
async function sitePackagesNames(output: tg.Directory) {
	const sitePackages = await output
		.get("lib/python3/site-packages")
		.then(tg.Directory.expect);
	return Object.keys(await sitePackages.entries);
}

export async function testPlatformWheel() {
	// The fixture pins Python 3.14 with a `.python-version` file.
	const source = await tests.get("native").then(tg.Directory.expect);
	const output = await build({ source });
	const text = await run(output, "native");
	tg.assert(
		text.trim() === "&lt;uv&gt; markupsafe._speedups",
		`unexpected output: ${text}`,
	);
	const python314 = await output.tryGet("lib/python3.14/site-packages");
	tg.assert(python314 instanceof tg.Directory, "expected python 3.14");
	return output;
}

export async function testHatchling() {
	const source = await tests.get("hatchling").then(tg.Directory.expect);
	const output = await build({ source });
	const text = await run(output, "hatched");
	tg.assert(
		text.trim() === "Hello from hatchling!",
		`unexpected output: ${text}`,
	);

	// The build backend must not be installed alongside the project.
	const names = await sitePackagesNames(output);
	tg.assert(!names.includes("hatchling"), `unexpected hatchling in ${names}`);
	return output;
}

export async function testMissingBackend() {
	const source = await tests.get("missing-backend").then(tg.Directory.expect);
	const succeeded = await build({ source }).then(
		() => true,
		() => false,
	);
	tg.assert(!succeeded, "expected the build to fail without its backend");
	return true;
}

export async function testWorkspace() {
	const source = await tests.get("workspace").then(tg.Directory.expect);

	// The workspace root depends on its member.
	const root = await build({ source });
	const text = await run(root, "root-app");
	tg.assert(
		text.trim() === "root: Hello from the member!",
		`unexpected output: ${text}`,
	);

	// Selecting the member must not install the root.
	const member = await build({ packages: ["member"], source });
	const names = await sitePackagesNames(member);
	tg.assert(names.includes("member"), `expected member in ${names}`);
	tg.assert(!names.includes("root_app"), `unexpected root_app in ${names}`);
	return root;
}
