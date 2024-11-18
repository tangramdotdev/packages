import * as bash from "bash" with { path: "../bash" };
import * as std from "std" with { path: "../std" };

import dylibDetectOsPatch from "./bzip2_dylib_detect_os.patch" with {
	type: "file",
};

export const metadata = {
	homepage: "https://sourceware.org/bzip2/",
	license:
		"https://sourceware.org/git/?p=bzip2.git;a=blob;f=LICENSE;hb=6a8690fc8d26c815e798c588f796eabe9d684cf0",
	name: "bzip2",
	repository: "https://sourceware.org/git/bzip2.git",
	version: "1.0.8",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:ab5a03176ee106d3f0fa90e381da478ddae405918153cca248e682cd0c4a2269";
	const extension = ".tar.gz" as const;
	const base = `https://sourceware.org/pub/${name}`;
	const source = std
		.download({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
	return std.patch(source, dylibDetectOsPatch);
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const sourceDir = source_ ?? source();

	// Define phases.
	const buildPhase = `make CC="$CC" SHELL="$SHELL" -f Makefile-libbz2_so && make CC="$CC" SHELL="$SHELL"`;
	const install = {
		args: [`PREFIX="$OUTPUT" SHELL="$SHELL"`],
	};
	const phases = {
		configure: tg.Mutation.unset(),
		build: buildPhase,
		install,
	};

	let output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			buildInTree: true,
			env,
			sdk,
			source: sourceDir,
			phases,
		},
		autotools,
	);

	// Wrap installed scripts.
	const bashScripts = ["bzdiff", "bzgrep", "bzmore"];

	for (const script of bashScripts) {
		const file = tg.File.expect(await output.get(`bin/${script}`));
		output = await tg.directory(output, {
			[`bin/${script}`]: bash.wrapScript(file, host),
		});
	}

	return output;
});

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({
		buildFn: default_,
		binaries: [{ name: "bzip2", testArgs: ["--help"] }],
		libraries: [{ name: "bz2", staticlib: true, dylib: false }],
		metadata,
	});
	return true;
});
