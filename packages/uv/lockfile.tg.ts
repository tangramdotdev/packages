import * as std from "std" with { source: "../std" };

/** The fields of a `uv.lock` file that are read outside of uv. */
export type Lockfile = {
	"requires-python"?: string;
	version: number;
};

/** A distribution file that uv needs, as selected by `plan.py`. */
export type Download = {
	checksum: string;
	filename: string;
	url: string;
};

/** Parse a `uv.lock` file. */
export async function parse(file: tg.File): Promise<Lockfile> {
	const lockfile = tg.encoding.toml.decode(await file.text) as Lockfile;
	tg.assert(
		lockfile.version === 1,
		`unsupported uv.lock version ${lockfile.version}`,
	);
	return lockfile;
}

/** Download distributions into a flat directory suitable for `--find-links`, verifying each against the SHA-256 digest recorded in `uv.lock`. */
export async function vendor(
	downloads: Array<Download>,
): Promise<tg.Directory> {
	const entries = await Promise.all(
		downloads.map(async ({ checksum: checksum_, filename, url }) => {
			const checksum = digest(checksum_, filename);
			tg.assert(
				!filename.includes("/") && !filename.startsWith("."),
				`invalid distribution filename ${filename}`,
			);
			const blob = await std.download({ checksum, url }).then(tg.Blob.expect);
			return [filename, await tg.file(blob)] as const;
		}),
	);
	const output = await tg.directory(Object.fromEntries(entries));
	return output;
}

/** Require a concrete SHA-256 digest. A value such as `sha256:any` is a valid checksum that disables verification, so it must not be accepted from a lockfile. */
export function digest(value: string, name: string): tg.Checksum {
	tg.assert(
		/^sha256:[0-9a-f]{64}$/.test(value),
		`the hash of ${name} in uv.lock is not a sha256 digest: ${value}`,
	);
	return value as tg.Checksum;
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

export function test() {
	const valid = `sha256:${"0a".repeat(32)}`;
	tg.assert(digest(valid, "a") === valid);
	for (const value of ["sha256:any", "sha256:none", "sha512:00", valid + "0"]) {
		let rejected = false;
		try {
			digest(value, "a");
		} catch {
			rejected = true;
		}
		tg.assert(rejected, `expected ${value} to be rejected`);
	}
	return true;
}
