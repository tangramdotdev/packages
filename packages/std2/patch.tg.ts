import { $ } from "./tangram.ts";

/** Apply one or more patches to a directory. Files and symlinks are assumed to be patchfiles, directories are recursively walked and any patchfiles found are added. */
export const patch = tg.target(
	async (source: tg.Directory, ...patches: Array<tg.Artifact>) => {
		// Collect all patchfiles.
		const patchFiles = await Promise.all(
			patches.flatMap(async (patchArtifact) => {
				if (patchArtifact instanceof tg.Directory) {
					const ret = [];
					for await (const [path, artifact] of patchArtifact.walk()) {
						if (artifact instanceof tg.File && /\.(diff|patch)$/.test(path)) {
							ret.push(artifact);
						}
					}
					return ret;
				} else {
					return patchArtifact;
				}
			}),
		).then((result) => result.flat());

		// Apply the patches.
		const allPatchFiles = tg.Template.join(" ", ...patchFiles);
		return await $`cp -R ${source} $OUTPUT && chmod -R u+w $OUTPUT && cat ${allPatchFiles} | patch -p1 -d $OUTPUT`.then(
			tg.Directory.expect,
		);
	},
);
