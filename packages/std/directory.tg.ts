import * as std from "./tangram.tg.ts";

/** Filter the contents of a directory according to a predicate. */
export let filter = async (
	directory: tg.Unresolved<tg.Directory>,
	predicate: (name: string, artifact: tg.Artifact) => boolean,
) => {
	let dir = await tg.resolve(directory);
	let ret = dir;
	for await (let [name, artifact] of dir) {
		if (!predicate(name, artifact)) {
			ret = await tg.directory(dir, { [`${name}`]: undefined });
		}
	}
	return ret;
};

/** Produce a directory containing only the named subdirectories if present. */
export let keepSubdirectories = async (
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
export let unwrap = async (directory: tg.Directory) => {
	return await std.download.unwrapDirectory(directory);
};
