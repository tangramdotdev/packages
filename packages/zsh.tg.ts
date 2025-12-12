import * as ncurses from "ncurses" with { local: "./ncurses.tg.ts" };
import * as pcre2 from "pcre2" with { local: "./pcre2.tg.ts" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.zsh.org/",
	license: "https://sourceforge.net/p/zsh/code/ci/master/tree/LICENCE",
	name: "zsh",
	repository: "https://sourceforge.net/p/zsh/code/ci/master/tree/",
	version: "5.9",
	tag: "zsh/5.9",
	provides: {
		binaries: ["zsh"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const url = `https://sourceforge.net/projects/zsh/files/zsh/5.9/${name}-${version}.tar.xz/download`;
	const checksum =
		"sha256:9b8d1ecedd5b5e81fbf1918e876752a7dd948e05c1a0dba10ab863842d45acd5";
	return await std.download
		.extractArchive({ url, checksum })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

const deps = await std.deps({
	ncurses: ncurses.build,
	pcre2: pcre2.build,
});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = (...args: std.Args<Arg>) =>
	std.autotools.build(
		std.autotools.arg(
			{
				source: source(),
				deps,
				env: {
					// Necessary to get the `boolcodes` configure test to pass, preventing a build failure in the termcap module later when it attempts to use a conflicting type.
					CFLAGS: tg.Mutation.prefix(`-Wno-incompatible-pointer-types`, " "),
				},
				phases: {
					configure: {
						args: [
							"--enable-pcre",
							"--enable-multibyte",
							`--with-term-lib="tinfow ncursesw"`,
						],
					},
				},
			},
			...args,
		),
	);

export default build;

/** Wrap a shebang'd bash script to use this package's bach as the interpreter.. */
export const wrapScript = async (script: tg.File) => {
	const scriptMetadata = await std.file.executableMetadata(script);
	if (
		scriptMetadata?.format !== "shebang" ||
		!scriptMetadata.interpreter.includes("sh")
	) {
		throw new Error("Expected a shebang sh, bash, or zsh script");
	}
	const interpreter = tg.File.expect(await (await build()).get("bin/zsh"));
	return std.wrap(script, { interpreter });
};

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
