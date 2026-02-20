import * as bash from "bash" with { local: "../bash.tg.ts" };
import * as std from "std" with { local: "../std" };

import dylibDetectOsPatch from "./bzip2_dylib_detect_os.patch" with { type: "file" };

export const metadata = {
	homepage: "https://sourceware.org/bzip2/",
	license:
		"https://sourceware.org/git/?p=bzip2.git;a=blob;f=LICENSE;hb=6a8690fc8d26c815e798c588f796eabe9d684cf0",
	name: "bzip2",
	repository: "https://sourceware.org/git/bzip2.git",
	version: "1.0.8",
	tag: "bzip2/1.0.8",
	provides: {
		binaries: ["bzip2"],
		// FIXME - there is a dylib, but no pkgconfig.
		libraries: [
			{ name: "bz2", pkgConfigName: false, staticlib: true, dylib: false },
		],
	},
};

const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:db106b740252669664fd8f3a1c69fe7f689d5cd4b132f82ba82b9afba27627df";
	const owner = "libarchive";
	const repo = name;
	const tag = `${name}-${version}`;
	const source = std.download.fromGithub({
		checksum,
		repo,
		tag,
		owner,
		source: "tag",
	});
	return std.patch(source, dylibDetectOsPatch);
};

export type Arg = std.autotools.Arg;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{
			source: source(),
			buildInTree: true,
			phases: {
				configure: tg.Mutation.unset(),
				build: `make CC="cc" SHELL="$SHELL" -f Makefile-libbz2_so && make CC="cc" SHELL="$SHELL"`,
				install: { args: [tg`PREFIX="${tg.output}" SHELL="$SHELL"`] },
			},
		},
		...args,
	);

	let output = await std.autotools.build(arg);

	// Wrap installed bash scripts with proper interpreter.
	const bashScripts = ["bzdiff", "bzgrep", "bzmore"];
	for (const script of bashScripts) {
		const file = tg.File.expect(await output.get(`bin/${script}`));
		output = await tg.directory(output, {
			[`bin/${script}`]: bash.wrapScript(file, arg.host),
		});
	}
	return output;
};

export default build;

export const test = async () => {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.allBinaries(metadata.provides.binaries, {
			testArgs: ["--help"],
		}),
	};
	return await std.assert.pkg(build, spec);
};
