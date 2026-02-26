import * as libiconv from "libiconv" with { local: "./libiconv.tg.ts" };
import * as ncurses from "ncurses" with { local: "./ncurses.tg.ts" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/bash/",
	license: "GPL-3.0-or-later",
	name: "bash",
	repository: "https://git.savannah.gnu.org/git/bash.git",
	version: "5.3",
	tag: "bash/5.3",
	provides: {
		binaries: ["bash"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:0d5cd86965f869a26cf64f4b71be7b96f90a3ba8b3d74e27e8e9d9d5550f31ba";
	return std.download.fromGnu({ name, version, checksum });
};

export const deps = () =>
	std.deps({
		libiconv: libiconv.build,
		ncurses: ncurses.build,
	});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = async (...args: std.Args<Arg>) =>
	std.autotools.build(
		{
			deps,
			source: source(),
			env: { CFLAGS: tg.Mutation.suffix("-std=gnu17", " ") },
			phases: {
				configure: { args: ["--without-bash-malloc", "--with-curses"] },
			},
		},
		...args,
	);

export default build;

/** Wrap a shebang'd bash script to use this package's bach as the interpreter.. */
export const wrapScript = async (
	script: tg.File,
	host: string,
	env?: tg.Unresolved<std.env.Arg>,
) => {
	const scriptMetadata = await std.file.executableMetadata(script);
	if (scriptMetadata?.format !== "shebang") {
		throw new Error("Expected a shebang sh or bash script");
	}
	const interpreter = tg.File.expect(
		await (await build({ host })).get("bin/bash"),
	);
	return std.wrap(script, { interpreter, env });
};

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
