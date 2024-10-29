import { $ } from "std" with { path: "../std" };

import { versionString, wrapScripts } from "./tangram.ts";
export type Arg = tg.File;

export const install = tg.target(
	async (pythonArtifact: tg.Directory, requirements: Arg) => {
		// Download the requirements specified in any requirements.txt files.
		const downloads = await $`
					mkdir tmp
					export TMPDIR=tmp
					mkdir -p $OUTPUT

					# Download dependencies using the requirements.txt file.
					pip3               \\
						download         \\
						-d $OUTPUT       \\
						--no-deps        \\
						--require-hashes \\
						--disable-pip-version-check \\
						-r ${requirements}
				`
			.env(pythonArtifact)
			.checksum("unsafe")
			.then(tg.Directory.expect);

		let installedBins = tg.directory();
		let installedSitePackages = await tg.directory();

		// For each download, install to a local directory.
		for await (const [name, file] of downloads) {
			const installed = await $`
						cp "${file}" "${name}"
						export PYTHONUSERBASE=$OUTPUT
						mkdir -p $OUTPUT
						pip3                          \\
							install                     \\
							--no-warn-script-location   \\
							--disable-pip-version-check \\
							--user                      \\
							--no-deps                   \\
						${name} || true # allow failure, needed to skip unnecessary errors in pip install.
					`
				.env(pythonArtifact)
				.then(tg.Directory.expect);

			// Get any site-packages or bin directories that were installed by pip.
			const sitePackages = await installed.tryGet(
				`lib/python${versionString()}/site-packages`,
			);
			if (!(sitePackages instanceof tg.Directory)) {
				continue;
			}

			const bin = await installed.tryGet("bin");

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
		const installed = await tg.directory({
			["bin"]: installedBins,
			["lib/python3/site-packages"]: installedSitePackages,
		});

		const interpreter = await tg.symlink(
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
const mergeSitePackages = async (output: tg.Directory, input: tg.Directory) => {
	for await (const [name, artifact] of input) {
		// Resolve symlinks.
		let installed = await output.tryGet(name);
		if (installed instanceof tg.Symlink) {
			installed = await installed.resolve();
		}

		// Detect conflicting directories and merge, otherwise override.
		if (installed instanceof tg.Directory && artifact instanceof tg.Directory) {
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
