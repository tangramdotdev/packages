import * as std from "./tangram.tg.ts";

export let patch = tg.target(async (
	source: tg.Directory,
	...patches: Array<tg.File | tg.Symlink>
): Promise<tg.Directory> => {
	let patchFiles = tg.Template.join(" ", ...patches);
	return tg.Directory.expect(
		await std.build(
			tg`
				cp -R ${source} $OUTPUT
				chmod -R u+w $OUTPUT
				cat ${patchFiles} | patch -p1 -d $OUTPUT`,
		),
	);
});
