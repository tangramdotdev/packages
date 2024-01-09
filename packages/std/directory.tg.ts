export let unwrap = tg.target(async (directory: tg.Directory): Promise<tg.Directory> => {
	let iterator = directory[Symbol.asyncIterator]();
	let inner = await iterator.next();
	tg.assert(
		(await iterator.next()).done,
		"Expected the directory to contain one entry.",
	);
	let ret = inner.value.at(1);
	tg.assert(tg.Directory.is(ret), "Expected the entry to be a directory.");
	return ret;
});
