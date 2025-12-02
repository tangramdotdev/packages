import { $ } from "./tangram.ts";

/** Apply one or more patches to a directory. Files and symlinks are assumed to be patchfiles, directories are recursively walked and any patchfiles found are added. */
export const patch = async (
	source: tg.Unresolved<tg.Directory>,
	...args: Array<tg.Unresolved<tg.Artifact> | { stripCount?: number }>
) => {
	// Separate options from patches
	const options =
		args.find(
			(arg): arg is { stripCount?: number } =>
				typeof arg === "object" && arg !== null && "stripCount" in arg,
		) || {};
	const patches = args.filter(
		(arg): arg is tg.Unresolved<tg.Artifact> =>
			!(typeof arg === "object" && arg !== null && "stripCount" in arg),
	);

	const stripCount = (options.stripCount ?? 1).toString();
	// Collect all patchfiles.
	const patchFiles = await Promise.all(
		patches.flatMap(async (patchArtifact) => {
			const patchArtifact_ = await tg.resolve(patchArtifact);
			if (patchArtifact_ instanceof tg.Directory) {
				const ret = [];
				for await (const [path, artifact] of patchArtifact_.walk()) {
					if (artifact instanceof tg.File && /\.(diff|patch)$/.test(path)) {
						ret.push(artifact);
					}
				}
				return ret;
			} else {
				return patchArtifact_;
			}
		}),
	).then((result) => result.flat());

	// Apply the patches.
	const allPatchFiles = tg.Template.join(" ", ...patchFiles);
	return await $`cp -R ${source} ${tg.output} && chmod -R u+w ${tg.output} && cat ${allPatchFiles} | patch -p${stripCount} -d ${tg.output}`.then(
		tg.Directory.expect,
	);
};
