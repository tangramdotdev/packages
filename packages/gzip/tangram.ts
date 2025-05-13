import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/gzip",
	license: "GPL-3.0-or-later",
	name: "gzip",
	repository: "https://git.savannah.gnu.org/git/gzip.git",
	version: "1.13",
	provides: {
		binaries: ["gzip"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:7454eb6935db17c6655576c2e1b0fabefd38b4d0936e0f87f48cd062ce91a057";
	return std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const configure = {
		args: ["--disable-dependency-tracking"],
	};

	const env = std.env.arg(env_);

	let output = await std.autotools.build({
		...(await std.triple.rotate({ build, host })),
		env,
		phases: { configure },
		sdk,
		source: source_ ?? source(),
	});

	const scriptNames = [
		"gunzip",
		"gzexe",
		"uncompress",
		"zcat",
		"zcmp",
		"zdiff",
		"zegrep",
		"zfgrep",
		"zforce",
		"zgrep",
		"zmore",
		"znew",
	];
	for (const path of scriptNames) {
		const file = tg.File.expect(await output.get(`bin/${path}`));
		const wrappedFile = changeShebang(file);
		output = await tg.directory(output, {
			[path]: wrappedFile,
		});
	}

	return output;
};

export default build;

/** Given a file containing a shell script, change the given shebang to use /usr/bin/env.  The SDK will place bash on the path.  */
export const changeShebang = async (scriptFile: tg.File) => {
	// Ensure the file has a shebang.
	const metadata = await std.file.executableMetadata(scriptFile);
	tg.assert(metadata.format === "shebang");

	// Replace the first line with a new shebang.
	const fileContents = await scriptFile.text();
	const firstNewlineIndex = fileContents.indexOf("\n");
	if (firstNewlineIndex === -1) {
		return tg.unreachable(
			"Could not find newline in file contents, but we asserted it begins with a shebang.",
		);
	}
	const fileWithoutShebangLine = fileContents.substring(firstNewlineIndex + 1);
	const newFileContents = `#!/usr/bin/env bash\n${fileWithoutShebangLine}`;
	const newFile = tg.file({ contents: newFileContents, executable: true });
	return newFile;
};

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
