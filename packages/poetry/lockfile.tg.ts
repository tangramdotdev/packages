/** Given a poetry.lock file, generate a valid requirements.txt with hashes. */
export type RequirementsArg = {
	/** The poetry.lock file. */
	lockFile: tg.File;
	/** Which dependency groups to include. Defaults to ["main"]. */
	groups?: Array<string>;
	/** Package names to exclude from the requirements. */
	exclude?: Array<string>;
};

export const requirements = async (arg: tg.File | RequirementsArg) => {
	const { lockFile, groups, exclude } =
		arg instanceof tg.File ? { lockFile: arg, groups: undefined, exclude: undefined } : arg;
	// Parse and validate the TOML.
	console.log(`lockfile: ${lockFile.id}`);
	const lockFileToml = tg.encoding.toml.decode(await lockFile.text) as LockFile;
	let text = ``;

	// By default, only include "main" group packages. If the lockfile doesn't use groups, include all packages.
	const allowedGroups = groups ?? ["main"];

	// poetry.lock files may contain multiple versions of the same package. We choose a heuristic to dedup packages with multiple versions, in this case by picking whichever appears first in the lock file..
	const packages = new Map<string, ParsedPackage>();
	for (const pkg of lockFileToml.package ?? []) {
		tg.assert(pkg.files, "Missing hashes from poetry.lock");

		// Filter by group if the lockfile has group information.
		if (pkg.groups) {
			const inGroup = pkg.groups.some((g) => allowedGroups.includes(g));
			if (!inGroup) {
				continue;
			}
		}

		const name = pkg.name;

		// Skip excluded packages.
		if (exclude?.includes(name)) {
			continue;
		}

		const version = pkg.version;
		const hashes = pkg.files.map((p) => tg.Checksum.expect(p.hash));

		const existing = packages.get(name);
		if (existing) {
			console.log(
				`Warning: conflicting versions of ${name} (${version}, ${existing.version}). Falling back to ${existing.version}.`,
			);
			continue;
		}

		packages.set(name, { name, version, hashes });
	}

	// Now that we have deduplicated packages, create the requirements.txt file.
	for (const [_, pkg] of Array.from(packages)) {
		text += `${pkg.name}==${pkg.version}`;
		for (const hash of pkg.hashes) {
			text += `\\\n    --hash=${hash}`;
		}
		text += "\n";
	}

	return tg.file(text);
};

type LockFile = {
	package: Array<{
		name: string;
		version: string;
		groups?: Array<string>;
		files?: Array<{ hash: string }>;
	}>;
};

type ParsedPackage = {
	name: string;
	version: string;
	hashes: Array<tg.Checksum>;
};
