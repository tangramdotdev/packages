import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/gzip",
	license: "GPL-3.0-or-later",
	name: "gzip",
	repository: "https://git.savannah.gnu.org/git/gzip.git",
	version: "1.14",
	tag: "gzip/1.14",
	provides: {
		binaries: ["gzip"],
	},
};

const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:01a7b881bd220bfdf615f97b8718f80bdfd3f6add385b993dcf6efd14e8c0ac6";
	return std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});
};

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

export type Arg = std.autotools.Arg;

export const build = async (...args: std.Args<Arg>) => {
	let output = await std.autotools.build(
		{
			source: source(),
			phases: {
				configure: { args: ["--disable-dependency-tracking"] },
			},
		},
		...args,
	);
	for (const path of scriptNames) {
		const file = tg.File.expect(await output.get(`bin/${path}`));
		const wrappedFile = changeShebang(file);
		output = await tg.directory(output, {
			[`bin/${path}`]: wrappedFile,
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
	const fileContents = await scriptFile.text;
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
