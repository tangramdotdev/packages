import ncurses from "tg:ncurses" with { path: "../ncurses" };
import pcre2 from "tg:pcre2" with { path: "../pcre2" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://www.zsh.org/",
	license: "https://sourceforge.net/p/zsh/code/ci/master/tree/LICENCE",
	name: "zsh",
	repository: "https://sourceforge.net/p/zsh/code/ci/master/tree/",
	version: "5.9",
};

export let source = tg.target(async (arg?: Arg) => {
	let { name, version } = metadata;
	let url = `https://sourceforge.net/projects/zsh/files/zsh/5.9/${name}-${version}.tar.xz/download`;
	let checksum =
		"sha256:9b8d1ecedd5b5e81fbf1918e876752a7dd948e05c1a0dba10ab863842d45acd5";
	return await std
		.download({ url, checksum, decompress: "xz", extract: "tar" })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let zsh = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let configure = {
		args: [
			"--enable-pcre",
			"--enable-multibyte",
			`--with-term-lib="tinfow ncursesw"`,
		],
	};
	let phases = { configure };

	let dependencies = [
		pcre2({ ...rest, build, env: env_, host }),
		ncurses({ ...rest, build, env: env_, host }),
	];
	let env = [
		...dependencies,
		{
			// Necessary to get the `boolcodes` configure test to pass, preventing a build failure in the termcap module later when it attempts to use a conflicting type.
			CFLAGS: tg.Mutation.templatePrepend(
				`-Wno-incompatible-pointer-types`,
				" ",
			),
		},
		env_,
	];

	return std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default zsh;

/** Wrap a shebang'd bash script to use this package's bach as the interpreter.. */
export let wrapScript = async (script: tg.File) => {
	let scriptMetadata = await std.file.executableMetadata(script);
	if (
		scriptMetadata?.format !== "shebang" ||
		!scriptMetadata.interpreter.includes("sh")
	) {
		throw new Error("Expected a shebang sh, bash, or zsh script");
	}
	let interpreter = tg.File.expect(await (await zsh()).get("bin/zsh"));
	return std.wrap(script, { interpreter, identity: "executable" });
};

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: zsh,
		binaries: ["zsh"],
		metadata,
	});
	return true;
});
