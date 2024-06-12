import { $ } from "./tangram.tg.ts";

export let patch = tg.target(
	async (
		source: tg.Directory,
		...patches: Array<tg.File | tg.Symlink>
	): Promise<tg.Directory> => {
		let patchFiles = tg.Template.join(" ", ...patches);
		return await $`
				cp -R ${source} $OUTPUT
				chmod -R u+w $OUTPUT
				cat ${patchFiles} | patch -p1 -d $OUTPUT`.then(tg.Directory.expect);
	},
);
