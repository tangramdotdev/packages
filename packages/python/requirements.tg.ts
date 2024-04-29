import * as std from "tg:std" with { path: "../std" };

import { versionString, wrapScripts } from "./tangram.tg.ts";
export type Arg = tg.File;

export let install = tg.target(
	async (pythonArtifact: tg.Directory, requirements: Arg) => {
		// Download the requirements specified in any requirements.txt files.
		let downloads = await std.build(
			tg`
					mkdir -p $OUTPUT

					# Download dependencies using the requirements.txt file.
					python3 -m pip     \\
						download         \\
						-d $OUTPUT       \\
						--no-deps        \\
						--require-hashes \\
						--disable-pip-version-check \\
						-r ${requirements}
				`,
			{
				env: pythonArtifact,
				targetArg: { checksum: "unsafe" },
			},
		);
		tg.Directory.assert(downloads);

		let installedBins = tg.directory();
		let installedSitePackages = await tg.directory();

		// For each download, install to a local directory.
		for await (let [name, file] of downloads) {
			let installed = await std.build(
				tg`
						cp "${file}" "${name}"
						export PYTHONUSERBASE=$OUTPUT
						mkdir -p $OUTPUT
						python3 -m pip                \\
							install                     \\
							--no-warn-script-location   \\
							--disable-pip-version-check \\
							--user                      \\
							--no-deps                   \\
						${name} || true # allow failure, needed to skip unnecessary errors in pip install.
					`,
				{ env: pythonArtifact },
			);
			tg.Directory.assert(installed);

			// Get any site-packages or bin directories that were installed by pip.
			let sitePackages = await installed.tryGet(
				`lib/python${versionString()}/site-packages`,
			);
			if (!tg.Directory.is(sitePackages)) {
				continue;
			}

			let bin = await installed.tryGet("bin");

			// Attempt a structural merge of the site packages directories.
			installedSitePackages = await mergeSitePackages(
				installedSitePackages,
				sitePackages,
			);

			// If there are any bins, copy them to the bin directory. TODO: create symlinks here?
			if (bin) {
				installedBins = tg.directory(installedBins, tg.Directory.expect(bin));
			}
		}

		// Create the installed environment containing a "bin" and "site-packages" directory by merging the things installed from source and from pip.
		let installed = await tg.directory({
			["bin"]: installedBins,
			["lib/python3/site-packages"]: installedSitePackages,
		});

		let interpreter = await tg.symlink(
			tg`${pythonArtifact}/bin/python${versionString()}`,
		);

		return wrapScripts(
			interpreter,
			await tg`${installed}/lib/python3/site-packages`,
			installed,
		);
	},
);

/** Detect any potentially conflicting installations in a site-packages directory and merge if necessary. */
let mergeSitePackages = async (output: tg.Directory, input: tg.Directory) => {
	for await (let [name, artifact] of input) {
		// Resolve symlinks.
		let installed = await output.tryGet(name);
		if (tg.Symlink.is(installed)) {
			installed = await installed.resolve();
		}

		// Detect conflicting directories and merge, otherwise override.
		if (tg.Directory.is(installed) && tg.Directory.is(artifact)) {
			output = await tg.directory(output, {
				[name]: tg.directory(installed, artifact),
			});
			continue;
		} else {
			output = await tg.directory(output, { [name]: tg.symlink(artifact) });
		}
	}

	return output;
};
