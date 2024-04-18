import * as std from "./tangram.tg.ts";

/** If the given directory contains a single child directory, return the inner child. */
export let unwrap = tg.target(async (directory: tg.Directory) => {
	return await std.download.unwrapDirectory(directory);
});
