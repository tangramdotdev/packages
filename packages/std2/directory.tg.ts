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

export let testKeepSubdirectories = tg.target(async () => {
	let orig = await tg.directory({
		a: tg.directory(),
		b: tg.directory(),
		c: tg.directory(),
	});
	let origId = await orig.id();
	console.log("orig", origId);

	let filtered = await keepSubdirectories(orig, "a", "c");
	let filteredId = await filtered.id();
	console.log("filtered", filteredId);

	let maybeA = await filtered.tryGet("a");
	tg.assert(maybeA !== undefined && maybeA instanceof tg.Directory);

	let maybeB = await filtered.tryGet("b");
	tg.assert(maybeB === undefined);

	let maybeC = await filtered.tryGet("c");
	tg.assert(maybeC !== undefined && maybeC instanceof tg.Directory);

	return true;
});
