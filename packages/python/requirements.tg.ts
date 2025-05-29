import * as rust from "rust" with { path: "../rust" };
import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

import { versionString, wrapScripts } from "./tangram.ts";
export type Arg = tg.File;

export const install = async (
	pythonArtifactArg: tg.Unresolved<tg.Directory>,
	requirementsArg: tg.Unresolved<Arg>,
) => {
	const pythonArtifact = await tg.resolve(pythonArtifactArg);
	const requirements = await tg.resolve(requirementsArg);
	// Construct an env with the standard C/C++ sdks, the Rust toolchain, and Python.
	const toolchains = std.env.arg(std.sdk(), rust.self(), pythonArtifact);

	// Download the requirements specified in any requirements.txt files.
	const downloads = await $`
			mkdir work
			cd work
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
				-r ${requirements}`
		.env(toolchains)
		.checksum("sha256:any")
		.network(true)
		.then(tg.Directory.expect);

	let installedBins = tg.directory();
	let installedSitePackages = await tg.directory();

	// For each download, install to a local directory.
	for await (const [name, file] of downloads) {
		const installed = await $`
				mkdir work
				cd work
				cp "${file}" "${name}"
				mkdir tmp
				export TMPDIR=tmp
				export PYTHONUSERBASE=$OUTPUT
				mkdir -p $OUTPUT
				pip3                          \\
					install                     \\
					--no-warn-script-location   \\
					--disable-pip-version-check \\
					--user                      \\
					--no-deps                   \\
				${name} || true # allow failure, needed to skip unnecessary errors in pip install.`
			.env(toolchains)
			.checksum("sha256:any")
			.network(true)
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

		// If there are any bins, copy them to the bin directory.
		if (bin) {
			installedBins = tg.directory(installedBins, tg.Directory.expect(bin));
		}
	}

	// Create the installed environment containing a "bin" and "site-packages" directory by merging the things installed from source and from pip.
	const installed = await tg.directory({
		["bin"]: installedBins,
		["lib/python3/site-packages"]: installedSitePackages,
	});
	console.log("INSTALLED", await installed.id());

	const interpreter = await tg.symlink(
		tg`${pythonArtifact}/bin/python${versionString()}`,
	);

	return wrapScripts(
		interpreter,
		await tg`${installed}/lib/python3/site-packages`,
		installed,
	);
};

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
			output = await tg.directory(output, { [name]: artifact });
		}
	}

	return output;
};
