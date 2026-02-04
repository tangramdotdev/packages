import * as std from "./tangram.ts";

/** Filter the contents of a directory according to a predicate. */
export const filter = async (
	directory: tg.Unresolved<tg.Directory>,
	predicate: (name: string, artifact: tg.Artifact) => boolean,
) => {
	const dir = await tg.resolve(directory);
	let ret = dir;
	for await (const [name, artifact] of dir) {
		if (!predicate(name, artifact)) {
			ret = await tg.directory(dir, { [`${name}`]: undefined });
		}
	}
	return ret;
};

/** Produce a directory containing only the named subdirectories if present. */
export const keepSubdirectories = async (
	directory: tg.Unresolved<tg.Directory>,
	...subdirectories: Array<string>
) => {
	return filter(
		directory,
		(name: string, artifact: tg.Artifact) =>
			subdirectories.includes(name) && artifact instanceof tg.Directory,
	);
};

/** If the given directory contains a single child directory, return the inner child. */
export const unwrap = async (directory: tg.Directory) => {
	return await std.download.unwrapDirectory(directory);
};

/** Generate a `std.assert.Provides` object for a given directory. */
export const provides = async (
	directory: tg.Directory,
): Promise<std.assert.Provides> => {
	const binaries: Array<string> = [];
	const headers: Array<string> = [];
	const libraries: Array<std.assert.LibrarySpec> = [];
	const binDir = await directory.tryGet("bin");

	// Collect executables.
	if (binDir !== undefined && binDir instanceof tg.Directory) {
		for await (let [name, artifact] of binDir) {
			if (artifact instanceof tg.File && (await artifact.executable)) {
				binaries.push(name);
			}
		}
	}

	// Collect headers.
	const includeDir = await directory.tryGet("include");
	if (includeDir !== undefined && includeDir instanceof tg.Directory) {
		const collectHeaders = async (
			dir: tg.Directory,
			prefix: string = "",
		): Promise<void> => {
			for await (let [name, artifact] of dir) {
				if (artifact instanceof tg.File && name.endsWith(".h")) {
					headers.push(prefix ? `${prefix}/${name}` : name);
				} else if (artifact instanceof tg.Directory) {
					await collectHeaders(artifact, prefix ? `${prefix}/${name}` : name);
				}
			}
		};
		await collectHeaders(includeDir);
	}

	// Collect libraries.
	const libDir = await directory.tryGet("lib");
	if (libDir !== undefined && libDir instanceof tg.Directory) {
		const libraryMap = new Map<
			string,
			{
				staticlib: boolean;
				dylib: boolean;
				hasPkgConfig: boolean;
			}
		>();

		// Check for pkgconfig files
		const pkgconfigDir = await libDir.tryGet("pkgconfig");
		const pkgconfigFiles = new Set<string>();
		if (pkgconfigDir !== undefined && pkgconfigDir instanceof tg.Directory) {
			for await (let [name, artifact] of pkgconfigDir) {
				if (artifact instanceof tg.File && name.endsWith(".pc")) {
					pkgconfigFiles.add(name.slice(0, -3)); // remove .pc
				}
			}
		}

		for await (let [name, artifact] of libDir) {
			if (!(artifact instanceof tg.File)) continue;

			// Match library patterns
			// For static libraries: libfoo.a
			const staticMatch = name.match(/^lib([^/]+)\.a$/);
			// For dynamic libraries: libfoo.dylib, libfoo.so, libfoo.0.dylib, libfoo.so.0
			const dylibMatch = name.match(
				/^lib([^/]+?)(?:\.\d+)*\.(so|dylib)(?:\.\d+)*$/,
			);

			if (staticMatch || dylibMatch) {
				const baseName = (staticMatch || dylibMatch)?.[1];
				if (!baseName) continue;

				const libInfo = libraryMap.get(baseName) || {
					staticlib: false,
					dylib: false,
					hasPkgConfig: pkgconfigFiles.has(baseName),
				};
				if (staticMatch) libInfo.staticlib = true;
				if (dylibMatch) libInfo.dylib = true;
				libraryMap.set(baseName, libInfo);
			}
		}

		// Convert map entries to appropriate format
		for (const [name, info] of libraryMap) {
			// Use string form only if both lib types and pkgconfig file all exist
			if (info.staticlib && info.dylib && info.hasPkgConfig) {
				libraries.push(name);
			} else {
				// Use object form if missing either lib type or pkgconfig
				const spec: std.assert.LibrarySpec = {
					name,
					staticlib: info.staticlib,
					dylib: info.dylib,
				};
				// Only include pkgConfigName if the file exists
				if (info.hasPkgConfig) {
					spec.pkgConfigName = name;
				}
				libraries.push(spec);
			}
		}
	}

	return {
		...(binaries.length > 0 && { binaries }),
		...(headers.length > 0 && { headers }),
		...(libraries.length > 0 && { libraries }),
	};
};

export const test = async () => {
	await testKeepSubdirectories();
};

export const testKeepSubdirectories = async () => {
	let orig = await tg.directory({
		a: tg.directory(),
		b: tg.directory(),
		c: tg.directory(),
	});
	await orig.store();
	let origId = orig.id;
	console.log("orig", origId);

	let filtered = await keepSubdirectories(orig, "a", "c");
	await filtered.store();
	let filteredId = filtered.id;
	console.log("filtered", filteredId);

	let maybeA = await filtered.tryGet("a");
	tg.assert(maybeA !== undefined && maybeA instanceof tg.Directory);

	let maybeB = await filtered.tryGet("b");
	tg.assert(maybeB === undefined);

	let maybeC = await filtered.tryGet("c");
	tg.assert(maybeC !== undefined && maybeC instanceof tg.Directory);
};
