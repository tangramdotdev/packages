import gnuPatch from "./sdk/dependencies/patch.tg.ts";
import * as std from "./tangram.tg.ts";

export let patch = async (
	source: tg.Directory,
	...patches: Array<tg.File | tg.Symlink>
): Promise<tg.Directory> => {
	let patchFiles = tg.Template.join(" ", ...patches);
	return tg.Directory.expect(
		await std.build(
			tg`
				cp -R ${source} $OUTPUT
				cat ${patchFiles} | patch -p1 -d $OUTPUT`,
			{ env: gnuPatch() },
		),
	);
};
