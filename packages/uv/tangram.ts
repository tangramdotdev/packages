import * as python from "python" with { source: "../python" };
import * as std from "std" with { source: "../std" };
import { $ } from "std" with { source: "../std" };

import * as lockfile from "./lockfile.tg.ts";
import planScript from "./plan.py" with { type: "file" };
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
	/** The dependency groups that provide the build backends of the project and of any source distributions. They are made available to builds but are not installed. Default: `["build"]` if the project defines that group. */
	buildGroups?: Array<string>;

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
			buildGroups: "append",
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

/** Install a uv project and its locked dependencies. uv selects the packages, every distribution is downloaded with the digest recorded in `uv.lock`, and uv runs without network access. */
export async function build(...args: tg.Args<Arg>): Promise<tg.Directory> {
	const {
		buildGroups: buildGroups_,
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
	const interpreterPath =
		await tg`${pythonArtifact}/bin/python${pythonVersion}`;
	const interpreter = await tg.symlink(interpreterPath);

	// Create the env. An `sdk: "none"` argument adds no toolchain.
	const sdk = sdkArg === "none" ? [] : [std.sdk({ host }, sdkArg ?? {})];
	const env = await std.env.arg(
		...sdk,
		self({ host }),
		pythonArtifact,
		{
			UV_COMPILE_BYTECODE: "0",
			UV_LINK_MODE: "copy",
			UV_NO_MANAGED_PYTHON: "1",
			UV_NO_PROGRESS: "1",
			UV_OFFLINE: "1",
		},
		// Select wheels for the deployment target of the SDK, not for the version of the machine that runs the build.
		std.triple.os(host) === "darwin"
			? { MACOSX_DEPLOYMENT_TARGET: std.sdk.macOsDeploymentTarget }
			: null,
		env_ ?? null,
	);

	// Create the selection flags, validating each name so that it reaches uv as a single argument.
	const buildGroups = buildGroups_ ?? (await defaultBuildGroups(source));
	const flags = (flag: string, kind: string, names: Array<string>) =>
		names.flatMap((name) => [flag, validateName(kind, name)]);
	const packageFlags = flags("--package", "package", packages);
	const selection = [
		...(defaultGroups ? [] : ["--no-default-groups"]),
		...flags("--extra", "extra", extras),
		...flags("--group", "group", groups),
		...packageFlags,
	].join(" ");
	const buildSelection = [
		...flags("--only-group", "group", buildGroups),
		...packageFlags,
	].join(" ");

	// Create the scripts. The export fails if the lockfile is out of date for the manifests and the interpreter.
	const prepare = (tree?: tg.Directory) => tg`
		set -eu
		export HOME="$PWD/home" TMPDIR="$PWD/tmp" UV_CACHE_DIR="$PWD/cache"
		mkdir -p "$HOME" "$TMPDIR" "$PWD/work" ${tg.output}
		${tree !== undefined ? tg`cp -R ${tree}/. "$PWD/work"` : ""}
		chmod -R u+w "$PWD/work"
		cd "$PWD/work"`;
	const exportLocked = tg`uv export --locked --python ${interpreterPath}`;
	const exportRequirements = tg`${exportLocked} --format requirements.txt --no-header --no-annotate`;
	const exportPylock = tg`${exportLocked} --format pylock.toml --no-emit-local`;

	// Ask uv which locked packages are selected, and select the distributions of each for the interpreter. The requirements file carries the hashes that uv requires at installation, and the lock files carry the index, URLs, and hashes of each package. This reads the manifests alone, so that the dependencies are reused when only the code changes.
	const manifests = await extractManifests(source);
	const exportBuildPylock =
		buildGroups.length > 0
			? tg`${exportPylock} ${buildSelection} -o ${tg.output}/pylock.build.toml`
			: "";
	const plan = await std.build`
		${prepare(manifests)}
		if ! ${exportRequirements} --no-emit-local ${selection} -o ${tg.output}/requirements.txt; then
			echo 'error: uv could not verify uv.lock against the project without network access. If the lockfile is out of date, run "uv lock".' >&2
			exit 1
		fi
		${exportPylock} ${selection} -o ${tg.output}/pylock.toml
		${exportBuildPylock}
		PYTHONPATH=${packaging()} ${interpreterPath} ${planScript} ${tg.output}/downloads.json ${tg.output}/pylock*.toml`
		.env(env)
		.host(std.triple.archAndOs(host))
		.then(tg.Directory.expect);
	const requirements = await plan.get("requirements.txt").then(tg.File.expect);
	const downloads = await plan
		.get("downloads.json")
		.then(tg.File.expect)
		.then((file) => file.text)
		.then((text) => tg.encoding.json.decode(text) as Array<lockfile.Download>);

	// Download the selected distributions.
	const vendored = await lockfile.vendor(downloads);
	const install = tg`uv pip install --python ${interpreterPath} --no-python-downloads --prefix ${tg.output} --no-index --find-links ${vendored} --no-deps`;

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

	// Install the locked dependencies.
	const dependencies = await std.build`
		${prepare()}
		${install} --require-hashes -r ${requirements}
		${normalize}`
		.env(env)
		.host(std.triple.archAndOs(host))
		.then(tg.Directory.expect);

	// Build and install the project and any local packages it depends on.
	let builder = std.build`
		${prepare(source)}
		${exportRequirements} --only-emit-local --no-editable --no-hashes ${selection} -o "$TMPDIR/requirements.txt"
		if grep -q '[^[:space:]]' "$TMPDIR/requirements.txt"; then
			if ! ${install} -r "$TMPDIR/requirements.txt"; then
				echo 'error: failed to build the project. If the build backend could not be found, add it to uv.lock through a dependency group named in buildGroups, such as "build".' >&2
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

/** Return the `packaging` library, which implements the standard marker and wheel tag rules, as a wheel that Python can import directly. */
export async function packaging(): Promise<tg.File> {
	const blob = await std
		.download({
			checksum:
				"sha256:d7193f7c8e4e93f444fde0262bf90af30e16fa0ad0ad44cb553c87339b23cd1c",
			url: "https://files.pythonhosted.org/packages/63/34/ba1c580383c9eada3711951fef0795c80b829a078d72188184bcab9dd527/packaging-26.3-py3-none-any.whl",
		})
		.then(tg.Blob.expect);
	return tg.file(blob);
}

/** Return the `build` dependency group if the project defines it. */
async function defaultBuildGroups(source: tg.Directory) {
	const file = await source.tryGet("pyproject.toml");
	tg.assert(file instanceof tg.File, "could not locate pyproject.toml");
	const pyproject = tg.encoding.toml.decode(await file.text) as {
		"dependency-groups"?: Record<string, unknown>;
	};
	return "build" in (pyproject["dependency-groups"] ?? {}) ? ["build"] : [];
}

/** Require the name of an extra, a dependency group, or a package to be a valid Python distribution name. */
export function validateName(kind: string, name: string): string {
	tg.assert(
		/^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(name),
		`invalid ${kind} name: ${JSON.stringify(name)}`,
	);
	return name;
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
	// Use the pinned version if there is one. A pin that names a patch version must match an available version exactly.
	const pin = await source.tryGet(".python-version");
	if (pin instanceof tg.File) {
		const text = (await pin.text)
			.split("\n")
			.map((line) => line.trim())
			.find((line) => line.length > 0 && !line.startsWith("#"));
		const match = text?.match(/^(\d+)\.(\d+)(\.\d+)?$/);
		tg.assert(match, `unsupported .python-version: ${text}`);
		const version = `${match[1]}.${match[2]}` as PythonVersion;
		const available = Object.values(python.versions).map((v) => v.version);
		tg.assert(
			version in python.versions &&
				(match[3] === undefined || python.versions[version].version === text),
			`the python version ${text} from .python-version is not available, the available versions are ${available.join(", ")}`,
		);
		return version;
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
		testDevGroup(),
		testHatchling(),
		testHello(),
		testMissingBackend(),
		testNoBinary(),
		testPlan(),
		testPlatformWheel(),
		testPythonPin(),
		testSatisfies(),
		testStaleLockfile(),
		testToolchain(),
		testValidateName(),
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

export async function testNoBinary() {
	// The fixture sets `no-binary-package` for its dependency, whose build backend is in the `build` group.
	const source = await tests.get("no-binary").then(tg.Directory.expect);
	const output = await build({ source });
	const text = await run(output, "no-binary");
	tg.assert(text.trim() === "six 1.17.0", `unexpected output: ${text}`);

	// Without the build backend, the build succeeds only if the wheel is used.
	tg.assert(
		await rejects(build({ buildGroups: [], source })),
		"expected the dependency to be built from its source distribution",
	);

	// A dependency that is locked without a source distribution must be rejected, not installed from its wheel.
	const dependency = await tests.get("dependency").then(tg.Directory.expect);
	const pyproject = await dependency.get("pyproject.toml").then(tg.File.expect);
	const wheelOnly = await tg.directory(dependency, {
		"pyproject.toml": tg.file(
			`${await pyproject.text}\n[tool.uv]\nno-binary-package = ["cowsay"]\n`,
		),
	});
	tg.assert(
		await rejects(build({ source: wheelOnly })),
		"expected a wheel-only dependency to be rejected",
	);
	return output;
}

export async function testPlan() {
	// Plan a lock file that does not come from uv, with the default interpreter.
	const host = std.triple.host();
	const fixture = await tests.get("plan/pylock.toml").then(tg.File.expect);

	// Add a wheel that is specific to the interpreter but not to a platform.
	const interpreter = `cp${python.defaultVersion.replace(".", "")}`;
	const lock = await tg.file(`${await fixture.text}
[[packages]]
name = "interpreted"
version = "1.0"
wheels = [
    { url = "https://pypi.example/files/interpreted-1.0-${interpreter}-none-any.whl", hashes = { sha256 = "${"8".repeat(64)}" } },
]
`);
	const text =
		await $`PYTHONPATH=${packaging()} python3 ${planScript} ${tg.output} ${lock}`
			.env(python.self())
			.env({ MACOSX_DEPLOYMENT_TARGET: std.sdk.macOsDeploymentTarget })
			.then(tg.File.expect)
			.then((file) => file.text);
	const downloads = tg.encoding.json.decode(text) as Array<lockfile.Download>;
	const urls = downloads.map((download) => download.url);
	const darwin = std.triple.os(host) === "darwin";

	// A package that is locked from a different index on each platform must keep the index and hash of its platform.
	const split = downloads.filter((download) =>
		download.filename.startsWith("split-"),
	);
	const index = darwin ? "darwin" : "other";
	tg.assert(
		split.length === 1 &&
			split[0]?.url.startsWith(`https://${index}.example/`) &&
			split[0]?.checksum === `sha256:${(darwin ? "1" : "2").repeat(64)}`,
		`unexpected downloads: ${urls}`,
	);

	// Equally compatible builds must all be kept for uv to choose between, and incompatible wheels dropped.
	const rebuilt = urls.filter((url) => url.includes("/rebuilt-"));
	tg.assert(
		rebuilt.length === 2 && rebuilt.every((url) => url.includes("-py3-")),
		`unexpected downloads: ${urls}`,
	);

	// A wheel for the interpreter on any platform must be selected.
	tg.assert(
		urls.some((url) => url.includes("/interpreted-")),
		`unexpected downloads: ${urls}`,
	);

	// A wheel that requires a newer version of macOS than the deployment target must not be selected.
	const native = urls.filter((url) => url.includes("/native-"));
	tg.assert(
		darwin
			? native.length === 1 && native[0]?.includes("macosx_11_0")
			: native.length === 0,
		`unexpected downloads: ${urls}`,
	);
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

/** Return whether a promise is rejected. */
async function rejects(promise: PromiseLike<unknown>) {
	return promise.then(
		() => false,
		() => true,
	);
}

export async function testStaleLockfile() {
	// Add a dependency to the project without updating its lockfile.
	const hello = await tests.get("hello").then(tg.Directory.expect);
	const pyproject = await hello.get("pyproject.toml").then(tg.File.expect);
	const text = await pyproject.text;
	tg.assert(text.includes("dependencies = []"));
	const source = await tg.directory(hello, {
		"pyproject.toml": tg.file(
			text.replace("dependencies = []", 'dependencies = ["cowsay==6.1"]'),
		),
	});
	tg.assert(
		await rejects(build({ source })),
		"expected the build to fail with a stale lockfile",
	);
	return true;
}

export async function testDevGroup() {
	// The fixture locks its dev group with a digest that does not match the download, so the build succeeds only if the group is neither downloaded nor installed.
	const source = await tests.get("dev-group").then(tg.Directory.expect);
	const output = await build({ source });
	const names = await sitePackagesNames(output);
	tg.assert(names.includes("cowsay"), `expected cowsay in ${names}`);
	tg.assert(!names.includes("iniconfig"), `unexpected iniconfig in ${names}`);

	// Selecting the group must fail the download.
	tg.assert(
		await rejects(build({ groups: ["dev"], source })),
		"expected the mismatched digest to fail the build",
	);
	return output;
}

export async function testPythonPin() {
	const lock = { version: 1 };
	const select = (pin: string) =>
		tg
			.directory({ ".python-version": tg.file(pin) })
			.then((source) => selectPythonVersion(source, lock));
	const { version } = python.versions["3.14"];
	tg.assert((await select("3.14\n")) === "3.14");
	tg.assert((await select(`${version}\n`)) === "3.14");
	tg.assert(await rejects(select("3.14.0\n")), "expected 3.14.0 to fail");
	tg.assert(await rejects(select("3.9\n")), "expected 3.9 to fail");
	tg.assert(await rejects(select("pypy@3.11\n")), "expected pypy to fail");
	return true;
}

export async function testValidateName() {
	tg.assert(validateName("group", "dev-tools_1.x") === "dev-tools_1.x");
	for (const name of ["", "dev; rm -rf /", "$(id)", "a b", "-flag"]) {
		const rejected = await rejects((async () => validateName("group", name))());
		tg.assert(rejected, `expected ${JSON.stringify(name)} to be rejected`);
	}
	const source = await tests.get("hello").then(tg.Directory.expect);
	tg.assert(
		await rejects(build({ groups: ["dev; exit 0"], source })),
		"expected an invalid group name to fail the build",
	);
	return true;
}
