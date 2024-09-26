import * as ncurses from "ncurses" with { path: "../ncurses" };
import * as pcre2 from "pcre2" with { path: "../pcre2" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.zsh.org/",
	license: "https://sourceforge.net/p/zsh/code/ci/master/tree/LICENCE",
	name: "zsh",
	repository: "https://sourceforge.net/p/zsh/code/ci/master/tree/",
	version: "5.9",
};

export const source = tg.target(async (arg?: Arg) => {
	const { name, version } = metadata;
	const url = `https://sourceforge.net/projects/zsh/files/zsh/5.9/${name}-${version}.tar.xz/download`;
	const checksum =
		"sha256:9b8d1ecedd5b5e81fbf1918e876752a7dd948e05c1a0dba10ab863842d45acd5";
	return await std
		.download({ url, checksum, decompress: "xz", extract: "tar" })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		ncurses?: ncurses.Arg;
		pcre2?: pcre2.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: { ncurses: ncursesArg = {}, pcre2: pcre2Arg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const configure = {
		args: [
			"--enable-pcre",
			"--enable-multibyte",
			`--with-term-lib="tinfow ncursesw"`,
		],
	};
	const phases = { configure };

	const dependencies = [
		pcre2.build({ build, env: env_, host, sdk }, pcre2Arg),
		ncurses.build(ncursesArg),
	];
	const env = std.env.arg(
		...dependencies,
		{
			// Necessary to get the `boolcodes` configure test to pass, preventing a build failure in the termcap module later when it attempts to use a conflicting type.
			CFLAGS: tg.Mutation.prefix(`-Wno-incompatible-pointer-types`, " "),
		},
		env_,
	);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(env),
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

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
	return std.wrap(script, { interpreter, identity: "executable" });
};

export const test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["zsh"],
		metadata,
	});
	return true;
});
