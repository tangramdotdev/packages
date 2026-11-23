import * as std from "std" with { source: "../std" };

import tests from "./tests" with { type: "directory" };

/** The contents of a `uv.lock` file. */
export type Lockfile = {
	package?: Array<Package>;
	"requires-python"?: string;
	revision?: number;
	version: number;
};

export type Package = {
	name: string;
	sdist?: Distribution;
	source: Source;
	version?: string;
	wheels?: Array<Distribution>;
};

export type Source = {
	directory?: string;
	editable?: string;
	git?: string;
	path?: string;
	registry?: string;
	url?: string;
	virtual?: string;
};

export type Distribution = {
	hash?: string;
	url?: string;
};

/** A distribution file selected for download. */
export type Download = {
	checksum: tg.Checksum;
	filename: string;
	url: string;
};

/** The components of a wheel filename, with compressed tag sets expanded. */
export type Wheel = {
	abiTags: Array<string>;
	name: string;
	platformTags: Array<string>;
	pythonTags: Array<string>;
	version: string;
};

// The glibc version of the default SDK, defined in `packages/std/sdk/libc/glibc.tg.ts`.
const glibcVersion = "2.44";

// The musl version of the default SDK, defined in `packages/std/sdk/libc/musl.tg.ts`.
const muslVersion = "1.2";

/** Parse a `uv.lock` file. */
export async function parse(file: tg.File): Promise<Lockfile> {
	const lockfile = tg.encoding.toml.decode(await file.text) as Lockfile;
	tg.assert(
		lockfile.version === 1,
		`unsupported uv.lock version ${lockfile.version}`,
	);
	return lockfile;
}

/** Download the distributions that a `uv.lock` file pins for a host and Python version into a flat directory suitable for `--find-links`. */
export async function vendor(
	fileArg: tg.Unresolved<tg.File>,
	hostArg: tg.Unresolved<string>,
	pythonVersionArg: tg.Unresolved<string>,
): Promise<tg.Directory> {
	const file = await tg.resolve(fileArg);
	const host = await tg.resolve(hostArg);
	const pythonVersion = await tg.resolve(pythonVersionArg);
	const lockfile = await parse(file);
	const downloads = select(lockfile, host, pythonVersion);
	const entries = await Promise.all(
		downloads.map(async ({ checksum, filename, url }) => {
			const blob = await std.download({ checksum, url }).then(tg.Blob.expect);
			return [filename, await tg.file(blob)] as const;
		}),
	);
	const output = await tg.directory(Object.fromEntries(entries));
	return output;
}

/** Select the distributions to download for a host and Python version. */
export function select(
	lockfile: Lockfile,
	host: string,
	pythonVersion: string,
): Array<Download> {
	const downloads: Array<Download> = [];
	for (const pkg of lockfile.package ?? []) {
		// Reject the sources that cannot be pinned.
		const { source } = pkg;
		if (source.git !== undefined) {
			throw new Error(`git sources are not supported: ${pkg.name}`);
		}
		if (source.url !== undefined) {
			throw new Error(`url sources are not supported: ${pkg.name}`);
		}

		// Skip the packages that are built from the source directory.
		if (source.registry === undefined) {
			continue;
		}
		if (!/^https?:\/\//.test(source.registry)) {
			throw new Error(`local registries are not supported: ${pkg.name}`);
		}

		// Select every compatible wheel, or the source distribution if there is none. A package with neither is not installable on this host, so uv reports it only if a marker requires it.
		const wheels = (pkg.wheels ?? []).filter((wheel) =>
			isCompatible(parseWheelFilename(filename(wheel)), host, pythonVersion),
		);
		const distributions =
			wheels.length > 0 ? wheels : pkg.sdist !== undefined ? [pkg.sdist] : [];
		for (const distribution of distributions) {
			tg.assert(
				distribution.hash !== undefined,
				`the package ${pkg.name} has no hash in uv.lock`,
			);
			tg.assert(distribution.url !== undefined);
			downloads.push({
				checksum: tg.Checksum.expect(distribution.hash),
				filename: filename(distribution),
				url: distribution.url,
			});
		}
	}
	return downloads;
}

/** Return the filename of a distribution, which is the last segment of its URL. */
function filename(distribution: Distribution): string {
	tg.assert(distribution.url !== undefined, "the distribution has no url");
	const path = distribution.url.replace(/[?#].*$/, "");
	const segment = path.split("/").pop();
	tg.assert(segment, `the url ${distribution.url} has no filename`);
	return decodeURIComponent(segment);
}

/** Parse a wheel filename of the form `name-version(-build)?-python-abi-platform.whl`. */
export function parseWheelFilename(filename: string): Wheel {
	tg.assert(filename.endsWith(".whl"), `${filename} is not a wheel`);
	const parts = filename.slice(0, -".whl".length).split("-");
	tg.assert(
		parts.length === 5 || parts.length === 6,
		`the wheel filename ${filename} is malformed`,
	);
	const [platform, abi, python] = parts.slice(-3).reverse() as [
		string,
		string,
		string,
	];
	const [name, version] = parts as [string, string];
	return {
		abiTags: abi.split("."),
		name,
		platformTags: platform.split("."),
		pythonTags: python.split("."),
		version,
	};
}

/** Determine whether a wheel can be installed for CPython on a host. */
export function isCompatible(
	wheel: Wheel,
	host: string,
	pythonVersion: string,
): boolean {
	const minor = pythonMinor(pythonVersion);
	const interpreter = wheel.pythonTags.some((python) =>
		wheel.abiTags.some((abi) => isCompatibleInterpreter(python, abi, minor)),
	);
	const platform = wheel.platformTags.some((tag) =>
		isCompatiblePlatform(tag, host),
	);
	return interpreter && platform;
}

function pythonMinor(pythonVersion: string): number {
	const match = pythonVersion.match(/^3\.(\d+)/);
	tg.assert(match, `unsupported python version ${pythonVersion}`);
	return Number(match[1]);
}

function isCompatibleInterpreter(
	python: string,
	abi: string,
	minor: number,
): boolean {
	const cpython = python.match(/^cp3(\d+)$/);
	if (cpython) {
		const wheelMinor = Number(cpython[1]);
		if (abi === `cp3${minor}` || abi === "none") {
			return wheelMinor === minor;
		}
		if (abi === "abi3") {
			return wheelMinor <= minor;
		}
		return false;
	}
	if (abi !== "none") {
		return false;
	}
	if (python === "py3") {
		return true;
	}
	const generic = python.match(/^py3(\d+)$/);
	return generic !== null && Number(generic[1]) <= minor;
}

function isCompatiblePlatform(tag: string, host: string): boolean {
	if (tag === "any") {
		return true;
	}
	const arch = std.triple.arch(host);
	const os = std.triple.os(host);
	if (os === "darwin") {
		return isCompatibleMacOs(tag, arch);
	}
	if (os === "linux") {
		return isCompatibleLinux(tag, arch, std.triple.environment(host));
	}
	return false;
}

function isCompatibleMacOs(tag: string, arch: string): boolean {
	const match = tag.match(/^macosx_(\d+)_(\d+)_(.+)$/);
	if (!match) {
		return false;
	}
	const arches =
		arch === "aarch64" ? ["arm64", "universal2"] : ["x86_64", "universal2"];
	if (!arches.includes(match[3] as string)) {
		return false;
	}
	const wheelVersion = [Number(match[1]), Number(match[2])];
	const target = std.sdk.macOsDeploymentTarget.split(".").map(Number);
	return compareVersions(wheelVersion, target) <= 0;
}

function isCompatibleLinux(
	tag: string,
	arch: string,
	environment: string | undefined,
): boolean {
	if (environment === "musl") {
		const match = tag.match(/^musllinux_(\d+)_(\d+)_(.+)$/);
		if (!match || match[3] !== arch) {
			return false;
		}
		const wheelVersion = [Number(match[1]), Number(match[2])];
		const libc = muslVersion.split(".").map(Number);
		return compareVersions(wheelVersion, libc) <= 0;
	}
	if (tag === `linux_${arch}`) {
		return true;
	}
	const legacy: Record<string, string> = {
		manylinux1: "manylinux_2_5",
		manylinux2010: "manylinux_2_12",
		manylinux2014: "manylinux_2_17",
	};
	const prefix = tag.match(/^(manylinux(?:1|2010|2014))_/)?.[1];
	const normalized =
		prefix !== undefined ? tag.replace(prefix, legacy[prefix] as string) : tag;
	const match = normalized.match(/^manylinux_(\d+)_(\d+)_(.+)$/);
	if (!match || match[3] !== arch) {
		return false;
	}
	const wheelVersion = [Number(match[1]), Number(match[2])];
	const libc = glibcVersion.split(".").map(Number);
	return compareVersions(wheelVersion, libc) <= 0;
}

/** Compare two versions component by component, treating missing components as zero. */
export function compareVersions(a: Array<number>, b: Array<number>): number {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const difference = (a[i] ?? 0) - (b[i] ?? 0);
		if (difference !== 0) {
			return difference;
		}
	}
	return 0;
}

export async function test() {
	await Promise.all([testSelect(), testWheelTags()]);
	return true;
}

export function testWheelTags() {
	const cases: Array<[string, string, string, boolean]> = [
		["a-1.0-py3-none-any.whl", "aarch64-darwin", "3.15", true],
		["a-1.0-py2.py3-none-any.whl", "x86_64-linux", "3.13", true],
		["a-1.0-py314-none-any.whl", "x86_64-linux", "3.13", false],
		["a-1.0-1-py3-none-any.whl", "x86_64-linux", "3.13", true],
		[
			"a-1.0-cp315-cp315-manylinux_2_17_x86_64.manylinux2014_x86_64.whl",
			"x86_64-linux",
			"3.15",
			true,
		],
		[
			"a-1.0-cp315-cp315-manylinux_2_17_x86_64.manylinux2014_x86_64.whl",
			"aarch64-linux",
			"3.15",
			false,
		],
		[
			"a-1.0-cp314-cp314-manylinux_2_28_x86_64.whl",
			"x86_64-linux",
			"3.15",
			false,
		],
		[
			"a-1.0-cp39-abi3-manylinux_2_28_aarch64.whl",
			"aarch64-linux",
			"3.15",
			true,
		],
		[
			"a-1.0-cp315-abi3-manylinux_2_28_aarch64.whl",
			"aarch64-linux",
			"3.14",
			false,
		],
		[
			"a-1.0-cp315-cp315-manylinux_2_99_x86_64.whl",
			"x86_64-linux",
			"3.15",
			false,
		],
		["a-1.0-cp315-cp315-manylinux1_x86_64.whl", "x86_64-linux", "3.15", true],
		[
			"a-1.0-cp315-cp315-musllinux_1_2_x86_64.whl",
			"x86_64-linux",
			"3.15",
			false,
		],
		[
			"a-1.0-cp315-cp315-musllinux_1_2_x86_64.whl",
			"x86_64-linux-musl",
			"3.15",
			true,
		],
		[
			"a-1.0-cp315-cp315-manylinux_2_28_x86_64.whl",
			"x86_64-linux-musl",
			"3.15",
			false,
		],
		[
			"a-1.0-cp315-cp315-macosx_10_12_universal2.whl",
			"aarch64-darwin",
			"3.15",
			true,
		],
		["a-1.0-cp315-cp315-macosx_11_0_arm64.whl", "aarch64-darwin", "3.15", true],
		["a-1.0-cp315-cp315-macosx_11_0_arm64.whl", "x86_64-darwin", "3.15", false],
		[
			"a-1.0-cp315-cp315-macosx_99_0_arm64.whl",
			"aarch64-darwin",
			"3.15",
			false,
		],
		[
			"a-1.0-cp315-cp315t-macosx_11_0_arm64.whl",
			"aarch64-darwin",
			"3.15",
			false,
		],
		["a-1.0-cp315-cp315-win_amd64.whl", "x86_64-linux", "3.15", false],
	];
	for (const [name, host, pythonVersion, expected] of cases) {
		const actual = isCompatible(parseWheelFilename(name), host, pythonVersion);
		tg.assert(
			actual === expected,
			`expected ${name} on ${host} with python ${pythonVersion} to be ${expected ? "compatible" : "incompatible"}`,
		);
	}
	return true;
}

export async function testSelect() {
	const file = await tests.get("dependency/uv.lock").then(tg.File.expect);
	const lockfile = await parse(file);
	for (const host of std.triple.allHosts) {
		const filenames = select(lockfile, host, "3.15").map(
			(download) => download.filename,
		);
		const expected = ["cowsay-6.1-py3-none-any.whl"];
		tg.assert(
			JSON.stringify(filenames) === JSON.stringify(expected),
			`expected ${expected} on ${host} but got ${filenames}`,
		);
	}
	return true;
}
