import * as libiconv from "libiconv" with { local: "./libiconv.tg.ts" };
import * as ncurses from "ncurses" with { local: "./ncurses.tg.ts" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/bash/",
	license: "GPL-3.0-or-later",
	name: "bash",
	repository: "https://git.savannah.gnu.org/git/bash.git",
	version: "5.2.37",
	tag: "bash/5.2.37",
	provides: {
		binaries: ["bash"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:9599b22ecd1d5787ad7d3b7bf0c59f312b3396d1e281175dd1f8a4014da621ff";
	return std.download.fromGnu({ name, version, checksum });
};

const deps = () =>
	std.deps({
		libiconv: libiconv.build,
		ncurses: ncurses.build,
	});

export type Arg = std.autotools.Arg & std.deps.Arg<ReturnType<typeof deps>>;

export const build = async (...args: std.Args<Arg>) =>
	std.autotools.build(
		{
			deps: deps(),
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
