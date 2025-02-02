/** Givn a poetry.lock file, generate a valid requirements.txt with hashes. */
export const requirements = tg.command(async (lockFile: tg.File) => {
	// Parse and validate the TOML.
	console.log(`lockfile: ${await lockFile.id()}`);
	const lockFileToml = tg.encoding.toml.decode(
		await lockFile.text(),
	) as LockFile;
	let text = ``;

	// poetry.lock files may contain multiple versions of the same package. We choose a heuristic to dedup packages with multiple versions, in this case by picking whichever appears first in the lock file..
	const packages = new Map<string, ParsedPackage>();
	for (const pkg of lockFileToml.package) {
		tg.assert(pkg.files, "Missing hashes from poetry.lock");

		const name = pkg.name;
		const version = pkg.version;
		const hashes = pkg.files.map((p) => p.hash);

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
});

type LockFile = {
	package: Array<{
		name: string;
		version: string;
		files?: Array<{ hash: string }>;
	}>;
};

type ParsedPackage = {
	name: string;
	version: string;
	hashes: Array<tg.Checksum>;
};
