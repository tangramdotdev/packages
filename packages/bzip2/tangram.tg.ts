import * as bash from "tg:bash" with { path: "../bash" };
import * as std from "tg:std" with { path: "../std" };

import dylibDetectOsPatch from "./bzip2_dylib_detect_os.patch" with {
	type: "file",
};

export let metadata = {
	homepage: "https://sourceware.org/bzip2/",
	license:
		"https://sourceware.org/git/?p=bzip2.git;a=blob;f=LICENSE;hb=6a8690fc8d26c815e798c588f796eabe9d684cf0",
	name: "bzip2",
	repository: "https://sourceware.org/git/bzip2.git",
	version: "1.0.8",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:ab5a03176ee106d3f0fa90e381da478ddae405918153cca248e682cd0c4a2269";
	let extension = ".tar.gz" as const;
	let packageArchive = std.download.packageArchive({
		name,
		version,
		extension,
	});
	let url = `https://sourceware.org/pub/${name}/${packageArchive}`;
	let source = std
		.download({ url, checksum })
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

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let sourceDir = source_ ?? source();

	// Define phases.
	let buildPhase = `make CC="$CC" SHELL="$SHELL" -f Makefile-libbz2_so && make CC="$CC" SHELL="$SHELL"`;
	let install = {
		args: [`PREFIX="$OUTPUT" SHELL="$SHELL"`],
	};
	let phases = {
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
	let bashScripts = ["bzdiff", "bzgrep", "bzmore"];

	for (let script of bashScripts) {
		let file = tg.File.expect(await output.get(`bin/${script}`));
		output = await tg.directory(output, {
			[`bin/${script}`]: bash.wrapScript(file),
		});
	}

	return output;
});

export default build;

export let test = tg.target(async () => {
	let host = await std.triple.host();
	let os = std.triple.os(host);
	await std.assert.pkg({
		buildFunction: build,
		binaries: [{ name: "bzip2", testArgs: ["--help"] }],
		libraries: ["bz2"],
		metadata,
	});
	return true;
});
